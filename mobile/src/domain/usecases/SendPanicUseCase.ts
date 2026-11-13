/**
 * Send-panic use case.
 *
 * Panic is independent of tracking state: it is always attempted immediately,
 * three times, and — if the network is unavailable — persisted into the
 * high-priority SQLite queue owned by the native background service, which
 * drains it when connectivity returns (`docs/api-contract.md`, section 2).
 */
import {createPanicEvent, PanicEvent} from '../entities/PanicEvent';
import {Position} from '../entities/Position';

/** Port for the immediate (HTTP) delivery attempt. Implemented by `CoreLogApiClient`. */
export interface PanicTransport {
  /**
   * Posts one panic to `POST /api/panic`.
   *
   * @param event - panic to deliver.
   * @throws on network failure or non-2xx response.
   */
  sendPanic(event: PanicEvent): Promise<void>;
}

/**
 * Port for the offline fallback queue. Implemented by the native bridge
 * (`BackgroundServiceBridge.enqueuePanic`) so the queue lives in the
 * SQLite database owned by the background service.
 */
export interface PanicQueue {
  /**
   * Persists the panic in the high-priority queue for later delivery.
   *
   * @param event - panic to enqueue.
   */
  enqueuePanic(event: PanicEvent): Promise<void>;
}

/** Port exposing the most recent position (for `last_known_position`). */
export interface LastKnownPositionSource {
  /**
   * @returns the last known position, or `null when none was recorded yet.
   */
  getLastKnownPosition(): Promise<Position | null>;
}

/** Injectable clock so tests can fix `timestamp_utc`. */
export type PanicClock = () => Date;

/** Injectable id generator so tests can fix `event_id`. */
export type EventIdGenerator = () => string;

/** Injectable delay (real implementation uses `setTimeout`). */
export type DelayFunction = (ms: number) => Promise<void>;

/** Outcome of {@link SendPanicUseCase.execute}. */
export interface PanicSendResult {
  /** `event_id` of the panic that was sent/queued. */
  eventId: string;
  /** `true` when the server accepted the panic within the 3 attempts. */
  delivered: boolean;
  /** `true` when the panic was written to the offline queue instead. */
  queued: boolean;
  /** How many delivery attempts were made (1..3). */
  attempts: number;
  /** ISO-8601 UTC timestamp of the panic. */
  timestampUtc: string;
}

/** Dependencies of {@link SendPanicUseCase}. */
export interface SendPanicUseCaseDependencies {
  /** Immediate HTTP delivery. */
  transport: PanicTransport;
  /** High-priority offline queue. */
  queue: PanicQueue;
  /** Source of `last_known_position`. */
  positionSource: LastKnownPositionSource;
  /** Unique `event_id` generator (defaults to a UUID v4). */
  generateEventId?: EventIdGenerator;
  /** Clock for `timestamp_utc` (defaults to `() => new Date()`). */
  clock?: PanicClock;
  /** Inter-attempt delay (defaults to a real `setTimeout` promise). */
  delay?: DelayFunction;
}

/** Maximum immediate delivery attempts before falling back to the queue. */
export const PANIC_MAX_ATTEMPTS = 3;

/** Base pause between delivery attempts, multiplied by the attempt number. */
export const PANIC_RETRY_DELAY_MS = 250;

function defaultDelay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function uuidV4(): string {
  const cryptoObject = (globalThis as {crypto?: {randomUUID?: () => string}}).crypto;
  if (cryptoObject?.randomUUID) {
    return cryptoObject.randomUUID();
  }
  // Fallback for JS engines without `crypto.randomUUID` (e.g. older Hermes).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * Raises a panic for the given vehicle.
 *
 * Flow: build event → attempt `POST /api/panic` up to 3 times → on total
 * failure enqueue into the native high-priority SQLite queue (drained by the
 * background service when the network returns).
 */
export class SendPanicUseCase {
  private readonly transport: PanicTransport;
  private readonly queue: PanicQueue;
  private readonly positionSource: LastKnownPositionSource;
  private readonly generateEventId: EventIdGenerator;
  private readonly clock: PanicClock;
  private readonly delay: DelayFunction;

  /**
   * @param dependencies - transport, queue, position source and injectables.
   */
  constructor(dependencies: SendPanicUseCaseDependencies) {
    this.transport = dependencies.transport;
    this.queue = dependencies.queue;
    this.positionSource = dependencies.positionSource;
    this.generateEventId = dependencies.generateEventId ?? uuidV4;
    this.clock = dependencies.clock ?? (() => new Date());
    this.delay = dependencies.delay ?? defaultDelay;
  }

  /**
   * Sends (or queues) a panic immediately — regardless of tracking state.
   *
   * @param vehicleId - vehicle raising the panic (`vehicle_id`).
   * @returns the {@link PanicSendResult} describing delivery or enqueueing.
   */
  async execute(vehicleId: string): Promise<PanicSendResult> {
    const eventId = this.generateEventId();
    const timestampUtc = this.clock().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const lastKnownPosition = await this.positionSource.getLastKnownPosition();
    const event = createPanicEvent({eventId, vehicleId, timestampUtc, lastKnownPosition});

    let attempts = 0;
    for (let attempt = 1; attempt <= PANIC_MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      try {
        await this.transport.sendPanic(event);
        return {eventId, delivered: true, queued: false, attempts, timestampUtc};
      } catch {
        if (attempt < PANIC_MAX_ATTEMPTS) {
          await this.delay(PANIC_RETRY_DELAY_MS * attempt);
        }
      }
    }

    await this.queue.enqueuePanic(event);
    return {eventId, delivered: false, queued: true, attempts, timestampUtc};
  }
}
