/**
 * CoreLog HTTP client (infrastructure layer).
 *
 * Single place where HTTP happens. Every payload uses the **snake_case**
 * wire format defined in `docs/api-contract.md`, every timestamp is ISO-8601
 * UTC, and a retry interceptor transparently re-sends transient failures
 * (network errors, 429, 5xx) with exponential backoff.
 */
import axios, {AxiosInstance, AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig} from 'axios';
import {Position} from '../../domain/entities/Position';
import {PanicEvent} from '../../domain/entities/PanicEvent';
import {CommandAck} from '../../domain/usecases/HandleRemoteCommandUseCase';

// ---------------------------------------------------------------------------
// Wire DTOs (snake_case — the exact shapes from docs/api-contract.md)
// ---------------------------------------------------------------------------

/** One item of the `POST /api/tracking/events` JSON array (contract §1). */
export interface TrackingEventDto {
  vehicle_id: string;
  latitude: number;
  longitude: number;
  timestamp_utc: string;
  speed_kmh?: number;
}

/** `last_known_position` block of `POST /api/panic` (contract §2). */
export interface PanicPositionDto {
  latitude: number;
  longitude: number;
  timestamp_utc: string;
  speed_kmh?: number;
}

/** Body of `POST /api/panic` (contract §2). */
export interface PanicRequestDto {
  event_id: string;
  vehicle_id: string;
  timestamp_utc: string;
  last_known_position: PanicPositionDto | null;
  source: 'MobileApp';
}

/** Body of `POST /api/devices/{deviceId}/commands/{commandId}/ack` (contract §3). */
export interface CommandAckDto {
  result: 'Ok' | 'Failed';
  message: string;
}

/** `202 Accepted` response of the position batch endpoint (contract §1). */
export interface BatchAccepted {
  accepted: number;
  rejected: number;
}

/** `201 Created` response of the panic endpoint (contract §2). */
export interface PanicAccepted {
  panic_id: string;
}

// ---------------------------------------------------------------------------
// Ports implemented by this client (consumed by the data layer)
// ---------------------------------------------------------------------------

/** Port used by `LocationRepository` to ship a position batch. */
export interface PositionBatchSender {
  /**
   * @param events - snake_case position payloads.
   * @throws on network failure or non-2xx response.
   */
  sendPositionBatch(events: TrackingEventDto[]): Promise<BatchAccepted>;
}

/** Port used by `CommandRepository` to acknowledge remote commands. */
export interface CommandAckTransport {
  /**
   * @param deviceId - `device_id` path segment.
   * @param commandId - `command_id` path segment.
   * @param ack - `{ result, message }` body.
   * @throws on network failure or non-2xx response.
   */
  sendCommandAck(deviceId: string, commandId: string, ack: CommandAck): Promise<void>;
}

// ---------------------------------------------------------------------------
// Domain → wire mapping
// ---------------------------------------------------------------------------

/**
 * Converts a domain {@link Position} into the snake_case batch item.
 *
 * @param position - domain entity.
 * @returns the wire payload for `POST /api/tracking/events`.
 */
export function toTrackingEventDto(position: Position): TrackingEventDto {
  const dto: TrackingEventDto = {
    vehicle_id: position.vehicleId,
    latitude: position.latitude,
    longitude: position.longitude,
    timestamp_utc: position.timestampUtc,
  };
  if (position.speedKmh !== undefined) {
    dto.speed_kmh = position.speedKmh;
  }
  return dto;
}

/**
 * Converts a domain {@link PanicEvent} into the `POST /api/panic` body.
 *
 * @param event - domain entity.
 * @returns the wire payload for `POST /api/panic`.
 */
export function toPanicRequestDto(event: PanicEvent): PanicRequestDto {
  const lastKnownPosition: PanicPositionDto | null = event.lastKnownPosition
    ? {
        latitude: event.lastKnownPosition.latitude,
        longitude: event.lastKnownPosition.longitude,
        timestamp_utc: event.lastKnownPosition.timestampUtc,
        ...(event.lastKnownPosition.speedKmh !== undefined
          ? {speed_kmh: event.lastKnownPosition.speedKmh}
          : {}),
      }
    : null;
  return {
    event_id: event.eventId,
    vehicle_id: event.vehicleId,
    timestamp_utc: event.timestampUtc,
    last_known_position: lastKnownPosition,
    source: event.source,
  };
}

// ---------------------------------------------------------------------------
// Retry interceptor
// ---------------------------------------------------------------------------

/** Per-request retry overrides carried in the axios config. */
interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  /** Number of retries already performed for this request. */
  retryCount?: number;
  /** Per-request retry cap (e.g. `0` for panic, where the use case counts attempts). */
  maxRetries?: number;
}

/** Options of {@link createRetryInterceptor}. */
export interface RetryInterceptorOptions {
  /** Retries performed for requests without an explicit `maxRetries`. @default 2 */
  maxRetries?: number;
  /** First backoff delay in ms; doubles every retry. @default 500 */
  baseDelayMs?: number;
  /** Upper bound for a single backoff delay. @default 5000 */
  maxDelayMs?: number;
  /** Injectable sleep (tests use an instant resolver). */
  sleep?: (ms: number) => Promise<void>;
}

/** HTTP statuses worth retrying (transient server/limit errors). */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function isRetryable(error: AxiosError): boolean {
  if (!error.response) {
    // Network failure / timeout — always worth retrying.
    return true;
  }
  return RETRYABLE_STATUS.has(error.response.status);
}

/**
 * Attaches the exponential-backoff retry interceptor to an axios instance.
 *
 * Retries network errors and `429/5xx` responses; other `4xx` fail fast.
 * Attempts are bounded by `maxRetries` (per request or global default).
 *
 * @param http - axios instance to instrument.
 * @param options - backoff tuning (see {@link RetryInterceptorOptions}).
 * @returns a function that ejects the interceptor.
 */
export function createRetryInterceptor(
  http: AxiosInstance,
  options: RetryInterceptorOptions = {},
): () => void {
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const sleep = options.sleep ?? defaultSleep;

  const interceptorId = http.interceptors.response.use(undefined, async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error);
    }
    const config = error.config as RetryableRequestConfig | undefined;
    if (!config || !isRetryable(error)) {
      return Promise.reject(error);
    }
    const retryCount = config.retryCount ?? 0;
    const limit = config.maxRetries ?? maxRetries;
    if (retryCount >= limit) {
      return Promise.reject(error);
    }
    config.retryCount = retryCount + 1;
    const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** retryCount);
    await sleep(delay);
    return http.request(config);
  });

  return () => {
    http.interceptors.response.eject(interceptorId);
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** Constructor options of {@link CoreLogApiClient}. */
export interface CoreLogApiClientOptions {
  /** `CORELOG_BASE_URL` (no trailing slash). */
  baseUrl: string;
  /** Pre-built axios instance (tests inject a stubbed one). */
  httpClient?: AxiosInstance;
  /** Retry tuning forwarded to {@link createRetryInterceptor}. */
  retry?: RetryInterceptorOptions;
  /** Per-request timeout in ms. @default 15000 */
  timeoutMs?: number;
}

/**
 * Typed CoreLog REST client.
 *
 * Implements {@link PositionBatchSender} and {@link CommandAckTransport};
 * panic delivery is exposed as {@link sendPanic} and consumed by
 * `SendPanicUseCase` (which owns the "3 attempts" policy — panic requests
 * therefore opt out of interceptor retries via `maxRetries: 0`).
 */
export class CoreLogApiClient implements PositionBatchSender, CommandAckTransport {
  /** Underlying axios instance (exposed for advanced wiring/tests). */
  readonly http: AxiosInstance;
  private readonly ejectRetry: () => void;

  /**
   * @param options - base url, optional injected http client and retry tuning.
   */
  constructor(options: CoreLogApiClientOptions) {
    this.http =
      options.httpClient ??
      axios.create({
        baseURL: options.baseUrl,
        timeout: options.timeoutMs ?? 15000,
        headers: {'Content-Type': 'application/json'},
      });
    this.ejectRetry = createRetryInterceptor(this.http, options.retry);
  }

  /**
   * Posts a batch of positions to `POST /api/tracking/events` (contract §1).
   *
   * @param events - snake_case position payloads (JSON array body).
   * @returns the `202 Accepted` counters.
   */
  async sendPositionBatch(events: TrackingEventDto[]): Promise<BatchAccepted> {
    const response = await this.http.post<BatchAccepted>('/api/tracking/events', events);
    return response.data;
  }

  /**
   * Posts a panic to `POST /api/panic` (contract §2).
   *
   * Retries are disabled here on purpose: `SendPanicUseCase` performs the
   * contractually required 3 immediate attempts itself.
   *
   * @param request - snake_case panic payload.
   * @returns the `201 Created` body with `panic_id`.
   */
  async sendPanic(request: PanicRequestDto): Promise<PanicAccepted> {
    const config: AxiosRequestConfig & {maxRetries?: number} = {maxRetries: 0};
    const response = await this.http.post<PanicAccepted>('/api/panic', request, config);
    return response.data;
  }

  /**
   * Acknowledges a remote command to
   * `POST /api/devices/{deviceId}/commands/{commandId}/ack` (contract §3).
   *
   * @param deviceId - `device_id` path segment.
   * @param commandId - `command_id` path segment.
   * @param ack - `{ result, message }` body.
   */
  async sendCommandAck(deviceId: string, commandId: string, ack: CommandAck): Promise<void> {
    const body: CommandAckDto = {result: ack.result, message: ack.message};
    await this.http.post(`/api/devices/${encodeURIComponent(deviceId)}/commands/${encodeURIComponent(commandId)}/ack`, body);
  }

  /** Detaches the retry interceptor (used on teardown). */
  dispose(): void {
    this.ejectRetry();
  }
}
