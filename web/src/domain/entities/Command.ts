/**
 * Domain entity: device commands and the acknowledgement lifecycle.
 *
 * Commands are never sent to devices by the dashboard — they are dispatched
 * to CoreLog (`POST /api/devices/{deviceId}/commands`) which delivers them
 * (FCM data message or tracker provider API) and later emits `CommandAcked`
 * over SignalR. `CommandAckTracker` bridges that asynchronous flow with a
 * timeout so the UI can show a failed state when no ack arrives.
 */

/** Command types accepted by CoreLog (docs/api-contract.md, §3). */
export type CommandType =
  | 'SET_FREQUENCY'
  | 'SILENCE'
  | 'REACTIVATE'
  | 'REQUEST_IMMEDIATE_POSITION';

/** Command delivery status (docs/api-contract.md, §3: `Pending|Acked|Failed|Silenced`). */
export type CommandStatus = 'Pending' | 'Acked' | 'Failed' | 'Silenced';

/** Type-specific command payload (only the keys of the chosen command matter). */
export interface CommandPayload {
  seconds?: number;
  duration_seconds?: number;
}

/** Body of `POST /api/devices/{deviceId}/commands`. */
export interface DispatchCommandRequest {
  command_type: CommandType;
  payload: CommandPayload;
}

/** A command record as stored by CoreLog. */
export interface Command {
  command_id: string;
  device_id: string;
  command_type: CommandType;
  payload: CommandPayload;
  status: CommandStatus;
  created_at_utc: string;
  acknowledged_at_utc: string | null;
  silenced_until_utc: string | null;
  error: string | null;
}

/** Response of `GET /api/devices/{deviceId}/commands`. */
export interface CommandListResponse {
  items: Command[];
}

/** Payload of the `CommandAcked` SignalR event (docs/api-contract.md, §6). */
export interface CommandAckedPayload {
  command_id: string;
  device_id: string;
  status: CommandStatus;
  acknowledged_at_utc: string;
}

/** Terminal outcome of a dispatched command observed by the UI. */
export interface CommandOutcome {
  command_id: string;
  status: 'Acked' | 'Failed';
  acknowledged_at_utc: string | null;
  error: string | null;
}

/** Extra values required by some command types. */
export interface CommandRequestOptions {
  seconds?: number;
  durationSeconds?: number;
}

/**
 * Builds the request body for a command, validating the payload of the
 * commands that require one.
 *
 * @param type - Command type to build.
 * @param options - Payload values (`seconds` for `SET_FREQUENCY`,
 * `durationSeconds` for `SILENCE`).
 * @returns The request body ready to POST to CoreLog.
 * @throws {Error} When a required payload value is missing or not positive.
 */
export function buildCommandRequest(
  type: CommandType,
  options: CommandRequestOptions = {},
): DispatchCommandRequest {
  switch (type) {
    case 'SET_FREQUENCY': {
      const seconds = options.seconds;
      if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('SET_FREQUENCY requires a positive "seconds" value.');
      }
      return { command_type: type, payload: { seconds } };
    }
    case 'SILENCE': {
      const durationSeconds = options.durationSeconds;
      if (
        durationSeconds === undefined ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0
      ) {
        throw new Error('SILENCE requires a positive "durationSeconds" value.');
      }
      return { command_type: type, payload: { duration_seconds: durationSeconds } };
    }
    case 'REACTIVATE':
    case 'REQUEST_IMMEDIATE_POSITION':
      return { command_type: type, payload: {} };
  }
}

interface PendingAck {
  resolve: (outcome: CommandOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Maximum number of acks remembered before a command registers its waiter. */
const MAX_RECENT_ACKS = 32;

function toOutcome(payload: CommandAckedPayload): CommandOutcome {
  const acknowledged = payload.status === 'Acked';
  return {
    command_id: payload.command_id,
    status: acknowledged ? 'Acked' : 'Failed',
    acknowledged_at_utc: payload.acknowledged_at_utc,
    error: acknowledged ? null : `Command finished with status "${payload.status}".`,
  };
}

/**
 * Bridges command dispatch and the asynchronous `CommandAcked` SignalR event.
 *
 * `track(commandId)` returns a promise that resolves when the matching ack
 * arrives, or with a `Failed` outcome when no ack arrives within the timeout.
 * Acks that arrive before the waiter is registered are buffered briefly so
 * very fast acknowledgements are never lost.
 */
export class CommandAckTracker {
  private readonly pending = new Map<string, PendingAck>();
  private readonly recentAcks = new Map<string, CommandAckedPayload>();

  /**
   * @param timeoutMs - Milliseconds to wait for `CommandAcked` before reporting failure.
   */
  constructor(private readonly timeoutMs: number = 10_000) {}

  /**
   * Waits for the acknowledgement of a dispatched command.
   *
   * @param commandId - Id returned by `POST /api/devices/{deviceId}/commands`.
   * @returns A promise resolving to the terminal `Acked` or `Failed` outcome.
   */
  track(commandId: string): Promise<CommandOutcome> {
    const buffered = this.recentAcks.get(commandId);
    if (buffered !== undefined) {
      this.recentAcks.delete(commandId);
      return Promise.resolve(toOutcome(buffered));
    }
    return new Promise<CommandOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        resolve({
          command_id: commandId,
          status: 'Failed',
          acknowledged_at_utc: null,
          error: `No acknowledgement received within ${this.timeoutMs} ms.`,
        });
      }, this.timeoutMs);
      this.pending.set(commandId, { resolve, timer });
    });
  }

  /**
   * Feeds a `CommandAcked` payload into the tracker.
   *
   * @param payload - Acknowledgement payload received over SignalR.
   * @returns `true` when a waiting command was resolved, `false` when the ack
   * was buffered (no waiter registered yet).
   */
  handleAck(payload: CommandAckedPayload): boolean {
    const entry = this.pending.get(payload.command_id);
    if (entry !== undefined) {
      clearTimeout(entry.timer);
      this.pending.delete(payload.command_id);
      entry.resolve(toOutcome(payload));
      return true;
    }
    this.recentAcks.set(payload.command_id, payload);
    if (this.recentAcks.size > MAX_RECENT_ACKS) {
      const oldest = this.recentAcks.keys().next().value;
      if (oldest !== undefined) {
        this.recentAcks.delete(oldest);
      }
    }
    return false;
  }

  /**
   * Cancels every waiter (used when a viewmodel unmounts). Cancelled waiters
   * resolve with a `Failed` outcome so no promise stays pending forever.
   */
  clear(): void {
    for (const [commandId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({
        command_id: commandId,
        status: 'Failed',
        acknowledged_at_utc: null,
        error: 'Command tracking was cancelled.',
      });
    }
    this.pending.clear();
    this.recentAcks.clear();
  }
}
