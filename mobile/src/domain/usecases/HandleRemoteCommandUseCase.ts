/**
 * Handle-remote-command use case.
 *
 * Applies one FCM data-message command to the device and acknowledges it
 * back to CoreLog with `POST /api/devices/{deviceId}/commands/{commandId}/ack`
 * (`docs/api-contract.md`, sections 3 and 8).
 *
 * Flow: `FcmCommandReceiver` → **this use case** → background-service bridge
 * (config update) → ack (`Ok`/`Applied`, or `Failed`/reason on error).
 */
import {RemoteCommand} from '../entities/RemoteCommand';

/** Acknowledgement body expected by the CoreLog ack endpoint. */
export interface CommandAck {
  /** `Ok` when the command was applied, `Failed` otherwise. */
  result: 'Ok' | 'Failed';
  /** Human-readable outcome (`Applied`, error reason, ...). */
  message: string;
}

/**
 * Port for applying a command to the native background service.
 * Implemented by `BackgroundServiceBridge` (infrastructure layer).
 */
export interface RemoteCommandTarget {
  /**
   * Applies the command (interval change, silence window, reactivate,
   * immediate position fix) to the running service.
   *
   * @param command - parsed remote command.
   * @throws when the native side rejects the command.
   */
  applyRemoteCommand(command: RemoteCommand): Promise<void>;
}

/** Port for sending the ack. Implemented by `CommandRepository`. */
export interface CommandAckSender {
  /**
   * Posts the ack body to `POST /api/devices/{deviceId}/commands/{commandId}/ack`.
   *
   * @param deviceId - target device (`device_id`).
   * @param commandId - correlation id (`command_id`).
   * @param ack - `{ result, message }` body.
   * @throws when the ack could not be delivered.
   */
  sendCommandAck(deviceId: string, commandId: string, ack: CommandAck): Promise<void>;
}

/** Result of {@link HandleRemoteCommandUseCase.execute}. */
export interface RemoteCommandResult {
  /** Whether the command side effect succeeded. */
  applied: boolean;
  /** Whether the ack reached CoreLog. */
  acked: boolean;
}

/** Optional error sink so the receiver never crashes the message handler. */
export type CommandErrorHandler = (error: unknown, command: RemoteCommand) => void;

/**
 * Port for the JS-side immediate-position fast path. When CoreLog asks for a
 * position while tracking is OFF, the JavaScript layer can deliver the last
 * known fix right away through `LocationRepository` instead of waiting for
 * the native service.
 */
export interface ImmediatePositionReporter {
  /**
   * @returns `true` when a position was posted to CoreLog,
   *          `false` when none is available (caller falls back to the
   *          native service).
   */
  reportIfAvailable(): Promise<boolean>;
}

/** Options of {@link HandleRemoteCommandUseCase}. */
export interface HandleRemoteCommandOptions {
  /** Error sink (defaults to swallowing errors). */
  onError?: CommandErrorHandler;
  /** JS-side immediate-position fast path (optional). */
  immediatePositionReporter?: ImmediatePositionReporter;
}

/**
 * Applies a single remote command and acknowledges the outcome to CoreLog.
 *
 * @remarks
 * The ack is always attempted, even when applying the command fails, so the
 * operator sees `Failed` instead of an eternal `Pending` in the command
 * history. Errors never propagate to the FCM handler.
 */
export class HandleRemoteCommandUseCase {
  private readonly onError: CommandErrorHandler;
  private readonly immediatePositionReporter: ImmediatePositionReporter | undefined;

  /**
   * @param target - applies commands to the background service.
   * @param ackSender - delivers acks to CoreLog.
   * @param options - optional error sink and immediate-position reporter.
   */
  constructor(
    private readonly target: RemoteCommandTarget,
    private readonly ackSender: CommandAckSender,
    options: HandleRemoteCommandOptions = {},
  ) {
    this.onError = options.onError ?? (() => undefined);
    this.immediatePositionReporter = options.immediatePositionReporter;
  }

  /**
   * Applies `command` and sends the matching ack.
   *
   * @param command - parsed FCM command.
   * @returns whether the command was applied and whether the ack was sent.
   */
  async execute(command: RemoteCommand): Promise<RemoteCommandResult> {
    let applied = false;
    let ack: CommandAck;

    try {
      applied = await this.apply(command);
      ack = applied
        ? {result: 'Ok', message: 'Applied'}
        : {result: 'Failed', message: 'NoPositionAvailable'};
    } catch (error) {
      this.onError(error, command);
      ack = {result: 'Failed', message: this.describeError(error)};
    }

    let acked = false;
    try {
      await this.ackSender.sendCommandAck(command.deviceId, command.commandId, ack);
      acked = true;
    } catch (error) {
      this.onError(error, command);
    }

    return {applied, acked};
  }

  private describeError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message.slice(0, 200);
    }
    return 'ApplyFailed';
  }

  /**
   * Applies the command through the JS fast path (when applicable) or the
   * native target.
   *
   * @returns `false` only when the immediate-position reporter ran but had
   *          no position to deliver.
   */
  private async apply(command: RemoteCommand): Promise<boolean> {
    if (
      command.commandType === 'REQUEST_IMMEDIATE_POSITION' &&
      this.immediatePositionReporter
    ) {
      const delivered = await this.immediatePositionReporter.reportIfAvailable();
      if (delivered) {
        return true;
      }
      // No position yet — let the native layer acquire one (cold start).
    }
    await this.target.applyRemoteCommand(command);
    return true;
  }
}
