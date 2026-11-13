/**
 * Domain entity: panic (distress) events.
 *
 * Two shapes exist on purpose:
 * - `PanicEvent` is the persisted record returned by `GET /api/panic`.
 * - `PanicReceivedPayload` is the live `PanicReceived` SignalR payload, which
 *   carries only the fields the backend emits in real time.
 */

/** Last known position attached to a panic (timestamp is optional live). */
export interface PanicLastKnownPosition {
  latitude: number;
  longitude: number;
  timestamp_utc?: string | null;
}

/** Persisted panic record (`GET /api/panic`, docs/api-contract.md, §2). */
export interface PanicEvent {
  panic_id: string;
  event_id: string;
  vehicle_id: string;
  timestamp_utc: string;
  last_known_position: PanicLastKnownPosition | null;
  source: string;
  acknowledged: boolean;
  acknowledged_at_utc: string | null;
  acknowledged_by: string | null;
}

/** Payload of the `PanicReceived` SignalR event (docs/api-contract.md, §6). */
export interface PanicReceivedPayload {
  panic_id: string;
  event_id: string;
  vehicle_id: string;
  timestamp_utc: string;
  last_known_position: { latitude: number; longitude: number };
  source: string;
}

/** Paginated response of `GET /api/panic`. */
export interface PanicListResponse {
  page: number;
  size: number;
  total_count: number;
  items: PanicEvent[];
}

/** Query filters accepted by `GET /api/panic` (`acknowledged`, `from`, `to`, `page`, `size`). */
export interface PanicQuery {
  acknowledged?: boolean;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
}

/** Body of `POST /api/panic/{panicId}/ack`. */
export interface AcknowledgePanicRequest {
  operator: string;
}

/**
 * Converts a live `PanicReceived` payload into the persisted `PanicEvent`
 * shape, defaulting the acknowledgement fields to "pending".
 *
 * @param payload - Live payload received over SignalR.
 * @returns A pending, unacknowledged panic record.
 */
export function panicFromPayload(payload: PanicReceivedPayload): PanicEvent {
  return {
    panic_id: payload.panic_id,
    event_id: payload.event_id,
    vehicle_id: payload.vehicle_id,
    timestamp_utc: payload.timestamp_utc,
    last_known_position: {
      latitude: payload.last_known_position.latitude,
      longitude: payload.last_known_position.longitude,
      timestamp_utc: null,
    },
    source: payload.source,
    acknowledged: false,
    acknowledged_at_utc: null,
    acknowledged_by: null,
  };
}

/**
 * Adds a live panic to the list, ignoring duplicates by `panic_id`.
 *
 * @param existing - Current panic list.
 * @param payload - Live `PanicReceived` payload.
 * @returns A new list with the panic prepended, or the same list if already present.
 */
export function mergePanicReceived(
  existing: PanicEvent[],
  payload: PanicReceivedPayload,
): PanicEvent[] {
  if (existing.some((panic) => panic.panic_id === payload.panic_id)) {
    return existing;
  }
  return [panicFromPayload(payload), ...existing];
}
