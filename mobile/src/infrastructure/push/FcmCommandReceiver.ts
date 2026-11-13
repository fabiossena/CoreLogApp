/**
 * FCM command receiver (infrastructure layer).
 *
 * Listens to Firebase Cloud Messaging **data messages** (no notification
 * payload) dispatched by CoreLog (`docs/api-contract.md`, section 8), parses
 * them into domain {@link RemoteCommand}s and hands them to
 * `HandleRemoteCommandUseCase`.
 *
 * Both delivery modes are covered:
 *
 * - **foreground** — `messaging().onMessage` while the app is open;
 * - **background** — `messaging().setBackgroundMessageHandler`, registered
 *   once at module scope so the headless JS runtime (Android) / background
 *   execution window (iOS) can process the command and ack it.
 */
import {RemoteCommand, parseRemoteCommand} from '../../domain/entities/RemoteCommand';
import {HandleRemoteCommandUseCase} from '../../domain/usecases/HandleRemoteCommandUseCase';

/** Raw FCM data payload (`RemoteMessage.data`). */
export type FcmDataPayload = Record<string, string | number | boolean | undefined>;

/** Normalized message handed to the parser. */
export interface FcmMessage {
  /** Data payload (snake_case keys, string values). */
  data: FcmDataPayload;
}

/** Port over `@react-native-firebase/messaging` (injectable for tests). */
export interface FcmMessagingPort {
  /**
   * Registers a handler for messages received while the app is in foreground.
   *
   * @param handler - receives the raw message.
   * @returns an unsubscribe function.
   */
  onMessage(handler: (message: FcmMessage) => void): () => void;
}

/** Outcome of {@link FcmCommandReceiver.handleMessage}. */
export interface FcmHandleOutcome {
  /** `true` when the payload was a valid CoreLog command. */
  recognized: boolean;
  /** The parsed command (when recognized). */
  command?: RemoteCommand;
  /** Whether the use case completed (applied + acked attempts finished). */
  processed: boolean;
}

/** Optional error sink (kept off the FCM critical path). */
export type FcmErrorHandler = (error: unknown) => void;

/** Dependencies of {@link FcmCommandReceiver}. */
export interface FcmCommandReceiverDependencies {
  /** Command handling use case. */
  handleCommand: HandleRemoteCommandUseCase;
  /** Messaging port (defaults to `@react-native-firebase/messaging`). */
  messaging?: FcmMessagingPort;
  /** Error sink (defaults to swallowing — the FCM handler must never throw). */
  onError?: FcmErrorHandler;
}

/**
 * Converts one FCM data message into a domain command and processes it.
 *
 * Invalid payloads (not a CoreLog command) are ignored without an ack —
 * CoreLog only acks messages it can correlate via `command_id`.
 */
export class FcmCommandReceiver {
  private readonly handleCommand: HandleRemoteCommandUseCase;
  private readonly onError: FcmErrorHandler;
  private messaging: FcmMessagingPort | undefined;
  private unsubscribeForeground: (() => void) | null = null;

  /**
   * @param dependencies - use case plus injectable messaging port.
   */
  constructor(dependencies: FcmCommandReceiverDependencies) {
    this.handleCommand = dependencies.handleCommand;
    this.onError = dependencies.onError ?? (() => undefined);
    this.messaging = dependencies.messaging;
  }

  /**
   * Parses and processes one FCM message.
   *
   * @param message - raw FCM message (`message.data`).
   * @returns an outcome describing recognition and processing.
   */
  async handleMessage(message: FcmMessage): Promise<FcmHandleOutcome> {
    const command = parseRemoteCommand(message.data ?? {});
    if (!command) {
      return {recognized: false, processed: false};
    }
    try {
      await this.handleCommand.execute(command);
      return {recognized: true, command, processed: true};
    } catch (error) {
      this.onError(error);
      return {recognized: true, command, processed: false};
    }
  }

  /**
   * Subscribes to foreground messages.
   *
   * @returns an unsubscribe function (idempotent — re-subscribing replaces
   *          the previous listener).
   */
  startForegroundListening(): () => void {
    if (this.unsubscribeForeground) {
      return this.unsubscribeForeground;
    }
    const messaging = this.resolveMessaging();
    if (!messaging) {
      return () => undefined;
    }
    const subscription = messaging.onMessage(message => {
      void this.handleMessage(message);
    });
    this.unsubscribeForeground = subscription;
    return () => {
      subscription();
      this.unsubscribeForeground = null;
    };
  }

  /** Stops foreground listening. */
  stopForegroundListening(): void {
    this.unsubscribeForeground?.();
    this.unsubscribeForeground = null;
  }

  private resolveMessaging(): FcmMessagingPort | undefined {
    if (this.messaging) {
      return this.messaging;
    }
    try {
      // Lazy require so Jest (which stubs this module) never loads Firebase.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const messagingModule = require('@react-native-firebase/messaging') as {
        default: () => FcmMessagingPort & {
          setBackgroundMessageHandler(handler: (message: FcmMessage) => Promise<void>): void;
        };
      };
      const messaging = messagingModule.default();
      this.messaging = {
        onMessage: handler => {
          const subscription = messaging.onMessage(handler);
          return () => subscription();
        },
      };
      return this.messaging;
    } catch {
      return undefined;
    }
  }
}

/**
 * Registers the **background** FCM handler. Must be called once from the
 * application entry point (`index.js` scope), before `AppRegistry.registerComponent`,
 * because the headless JS runtime re-executes this module when a data message
 * arrives while the app is closed.
 *
 * @param handleCommand - the shared command use case.
 * @param onError - optional error sink.
 * @returns `true` when the handler was installed.
 */
export function registerFcmBackgroundHandler(
  handleCommand: HandleRemoteCommandUseCase,
  onError: FcmErrorHandler = () => undefined,
): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const messagingModule = require('@react-native-firebase/messaging') as {
      default: () => {setBackgroundMessageHandler(handler: (message: FcmMessage) => Promise<void>): void};
    };
    const messaging = messagingModule.default();
    messaging.setBackgroundMessageHandler(async message => {
      try {
        const command = parseRemoteCommand(message.data ?? {});
        if (command) {
          await handleCommand.execute(command);
        }
      } catch (error) {
        onError(error);
      }
    });
    return true;
  } catch {
    return false;
  }
}
