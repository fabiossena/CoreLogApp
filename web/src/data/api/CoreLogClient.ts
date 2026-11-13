/**
 * Data layer: typed REST client for the CoreLog backend.
 *
 * The dashboard talks ONLY to CoreLog — never directly to devices or
 * trackers. Every command, panic acknowledgement and query goes through this
 * client so the backend stays the single integration point (FCM, provider
 * APIs, webhooks are all CoreLog-side concerns).
 *
 * List queries are served through the injected local cache (cache-aside)
 * before hitting the network. Viewmodels depend on the `ICoreLogClient`
 * interface (Dependency Inversion), so tests inject mocks instead of this class.
 */

import type {
  Device,
  PositionEvent,
} from '../../domain/entities/Device';
import type {
  AcknowledgePanicRequest,
  PanicEvent,
  PanicListResponse,
  PanicQuery,
} from '../../domain/entities/PanicEvent';
import type {
  Command,
  CommandListResponse,
  DispatchCommandRequest,
} from '../../domain/entities/Command';
import type {
  RegisterTrackerRequest,
  RegisterTrackerResponse,
  Tracker,
  TrackerListResponse,
} from '../../domain/entities/Tracker';
import type { CacheLike } from '../cache/localCache';
import { getOrLoad } from '../cache/localCache';

/** Paginated list envelope shared by the position history endpoints. */
interface PositionListResponse {
  page: number;
  size: number;
  total_count: number;
  total_pages?: number;
  from_utc?: string;
  to_utc?: string;
  items: PositionEvent[];
}

/** Single-position response of `GET /api/tracking/{vehicleId}/last`. */
type LastPositionResponse = PositionEvent;

/**
 * Error thrown when CoreLog responds with a non-2xx status.
 * The backend uses RFC 9110 problem+json bodies:
 * `{ "title": "...", "status": 400, "errors": { ... } }`.
 */
export class CoreLogApiError extends Error {
  /** HTTP status code returned by the backend. */
  readonly status: number;
  /** Machine-readable field errors, when the backend provided them. */
  readonly errors: Record<string, unknown> | null;

  constructor(message: string, status: number, errors: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'CoreLogApiError';
    this.status = status;
    this.errors = errors;
  }
}

/**
 * Port used by every viewmodel that reads data from CoreLog.
 * Declared in the data layer so the domain/ViewModels never import HTTP details.
 */
export interface ICoreLogClient {
  /** Device list for the dashboard (`GET /api/devices`, cached). */
  getDevices(): Promise<Device[]>;
  /** Panic list (`GET /api/panic`, cached). */
  getPanics(query?: PanicQuery): Promise<PanicEvent[]>;
  /** Acknowledges a panic (`POST /api/panic/{panicId}/ack`). */
  acknowledgePanic(panicId: string, request: AcknowledgePanicRequest): Promise<PanicEvent>;
  /** Dispatches a command (`POST /api/devices/{deviceId}/commands`). */
  dispatchCommand(deviceId: string, request: DispatchCommandRequest): Promise<Command>;
  /** Command history (`GET /api/devices/{deviceId}/commands`, cached). */
  getCommandHistory(deviceId: string): Promise<Command[]>;
  /** Position history in a time window (`GET /api/tracking/{vehicleId}/positions`, cached). */
  getPositions(vehicleId: string, fromUtc: string, toUtc: string): Promise<PositionEvent[]>;
  /** Latest position (`GET /api/tracking/{vehicleId}/last`, `null` on 404). */
  getLastPosition(vehicleId: string): Promise<LastPositionResponse | null>;
  /** Active trip trail (`GET /api/trips/{tripId}/positions`, cached). */
  getTripPositions(tripId: string): Promise<PositionEvent[]>;
  /** Registered trackers (`GET /api/trackers`, cached). */
  listTrackers(): Promise<Tracker[]>;
  /** Registers a tracker (`POST /api/trackers`). */
  registerTracker(request: RegisterTrackerRequest): Promise<RegisterTrackerResponse>;
  /** Deletes a tracker (`DELETE /api/trackers/{trackerId}`). */
  deleteTracker(trackerId: string): Promise<void>;
}

/** Construction options of {@link CoreLogClient}. */
export interface CoreLogClientOptions {
  /** Base URL of CoreLog, without a trailing slash (e.g. `http://localhost:8090`). */
  baseUrl?: string;
  /** Local cache consulted before every list query. */
  cache: CacheLike;
  /** Fetch implementation (injectable for tests; defaults to `globalThis.fetch`). */
  fetchImpl?: typeof fetch;
  /** TTL applied to cached list queries. */
  cacheTtlMs?: number;
}

function toQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const rendered = search.toString();
  return rendered === '' ? '' : `?${rendered}`;
}

async function toApiError(response: Response): Promise<CoreLogApiError> {
  let title = `Request failed with status ${response.status}.`;
  let errors: Record<string, unknown> | null = null;
  try {
    const body = (await response.json()) as {
      title?: string;
      status?: number;
      errors?: Record<string, unknown>;
    };
    if (typeof body.title === 'string' && body.title !== '') {
      title = body.title;
    }
    if (body.errors !== undefined && body.errors !== null) {
      errors = body.errors;
    }
  } catch {
    // Non-JSON body: keep the generic status message.
  }
  return new CoreLogApiError(title, response.status, errors);
}

/** Fills the nullable fields of a command record coming from the backend. */
function normalizeCommand(raw: Partial<Command> & Pick<Command, 'command_id' | 'device_id' | 'command_type' | 'status' | 'created_at_utc'>): Command {
  return {
    payload: raw.payload ?? {},
    acknowledged_at_utc: raw.acknowledged_at_utc ?? null,
    silenced_until_utc: raw.silenced_until_utc ?? null,
    error: raw.error ?? null,
    ...raw,
  } as Command;
}

/**
 * Concrete CoreLog REST client with cache-aside list queries.
 *
 * @example
 * ```ts
 * const client = new CoreLogClient({ baseUrl: 'http://localhost:8090', cache: new LocalCache() });
 * const devices = await client.getDevices();
 * ```
 */
export class CoreLogClient implements ICoreLogClient {
  private readonly baseUrl: string;
  private readonly cache: CacheLike;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;

  constructor(options: CoreLogClientOptions) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    this.cache = options.cache;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.cacheTtlMs = options.cacheTtlMs ?? 10_000;
  }

  /** Performs a JSON request and throws {@link CoreLogApiError} on non-2xx responses. */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.body !== undefined && init.body !== null) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });
    if (response.status === 204) {
      return undefined as T;
    }
    if (!response.ok) {
      throw await toApiError(response);
    }
    return (await response.json()) as T;
  }

  /** {@inheritDoc ICoreLogClient.getDevices} */
  async getDevices(): Promise<Device[]> {
    return getOrLoad(this.cache, 'devices', this.cacheTtlMs, async () => {
      const response = await this.request<{ items: Device[] }>('/api/devices');
      return response.items;
    });
  }

  /** {@inheritDoc ICoreLogClient.getPanics} */
  async getPanics(query: PanicQuery = {}): Promise<PanicEvent[]> {
    const key = `panics:${JSON.stringify(query)}`;
    return getOrLoad(this.cache, key, this.cacheTtlMs, async () => {
      const search = toQueryString({
        acknowledged: query.acknowledged,
        from: query.from,
        to: query.to,
        page: query.page,
        size: query.size,
      });
      const response = await this.request<PanicListResponse>(`/api/panic${search}`);
      return response.items;
    });
  }

  /** {@inheritDoc ICoreLogClient.acknowledgePanic} */
  async acknowledgePanic(
    panicId: string,
    request: AcknowledgePanicRequest,
  ): Promise<PanicEvent> {
    const updated = await this.request<PanicEvent>(
      `/api/panic/${encodeURIComponent(panicId)}/ack`,
      { method: 'POST', body: JSON.stringify(request) },
    );
    this.cache.deleteByPrefix('panics:');
    return updated;
  }

  /** {@inheritDoc ICoreLogClient.dispatchCommand} */
  async dispatchCommand(deviceId: string, request: DispatchCommandRequest): Promise<Command> {
    const raw = await this.request<Partial<Command> & Pick<Command, 'command_id' | 'device_id' | 'command_type' | 'status' | 'created_at_utc'>>(
      `/api/devices/${encodeURIComponent(deviceId)}/commands`,
      { method: 'POST', body: JSON.stringify(request) },
    );
    this.cache.deleteByPrefix(`commands:${deviceId}`);
    return normalizeCommand(raw);
  }

  /** {@inheritDoc ICoreLogClient.getCommandHistory} */
  async getCommandHistory(deviceId: string): Promise<Command[]> {
    const key = `commands:${deviceId}`;
    return getOrLoad(this.cache, key, this.cacheTtlMs, async () => {
      const response = await this.request<CommandListResponse>(
        `/api/devices/${encodeURIComponent(deviceId)}/commands`,
      );
      return response.items.map(normalizeCommand);
    });
  }

  /** {@inheritDoc ICoreLogClient.getPositions} */
  async getPositions(vehicleId: string, fromUtc: string, toUtc: string): Promise<PositionEvent[]> {
    const key = `positions:${vehicleId}:${fromUtc}:${toUtc}`;
    return getOrLoad(this.cache, key, this.cacheTtlMs, async () => {
      const search = toQueryString({ from: fromUtc, to: toUtc });
      const response = await this.request<PositionListResponse>(
        `/api/tracking/${encodeURIComponent(vehicleId)}/positions${search}`,
      );
      return response.items;
    });
  }

  /** {@inheritDoc ICoreLogClient.getLastPosition} */
  async getLastPosition(vehicleId: string): Promise<LastPositionResponse | null> {
    try {
      return await this.request<LastPositionResponse>(
        `/api/tracking/${encodeURIComponent(vehicleId)}/last`,
      );
    } catch (error) {
      if (error instanceof CoreLogApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /** {@inheritDoc ICoreLogClient.getTripPositions} */
  async getTripPositions(tripId: string): Promise<PositionEvent[]> {
    const key = `tripPositions:${tripId}`;
    return getOrLoad(this.cache, key, this.cacheTtlMs, async () => {
      const search = toQueryString({});
      const response = await this.request<PositionListResponse>(
        `/api/trips/${encodeURIComponent(tripId)}/positions${search}`,
      );
      return response.items;
    });
  }

  /** {@inheritDoc ICoreLogClient.listTrackers} */
  async listTrackers(): Promise<Tracker[]> {
    return getOrLoad(this.cache, 'trackers', this.cacheTtlMs, async () => {
      const response = await this.request<TrackerListResponse>('/api/trackers');
      return response.items;
    });
  }

  /** {@inheritDoc ICoreLogClient.registerTracker} */
  async registerTracker(request: RegisterTrackerRequest): Promise<RegisterTrackerResponse> {
    const created = await this.request<RegisterTrackerResponse>('/api/trackers', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    this.cache.delete('trackers');
    return created;
  }

  /** {@inheritDoc ICoreLogClient.deleteTracker} */
  async deleteTracker(trackerId: string): Promise<void> {
    await this.request<void>(`/api/trackers/${encodeURIComponent(trackerId)}`, {
      method: 'DELETE',
    });
    this.cache.delete('trackers');
  }
}
