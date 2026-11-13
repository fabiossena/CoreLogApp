/**
 * Domain entity: a tracked fleet device (vehicle) plus the pure helpers used
 * to derive its live status and to merge realtime events into the device list.
 *
 * These helpers are intentionally framework-free so both the viewmodels and
 * the unit tests can use them without React or network access.
 */

/** Status values reported for a device (see docs/api-contract.md, §5). */
export type DeviceStatus = 'Online' | 'Offline' | 'PossiblyOffline';

/**
 * A single GPS position. The same shape is used for REST list items
 * (`GET /api/tracking/{vehicleId}/positions`) and for the SignalR
 * `PositionReceived` payload (docs/api-contract.md, §6).
 */
export interface PositionEvent {
  event_id: string;
  vehicle_id: string;
  latitude: number;
  longitude: number;
  timestamp_utc: string;
  speed_kmh?: number | null;
  source: string;
  trip_id?: string | null;
}

/** Position snapshot stored on a device record (`GET /api/devices`). */
export interface DevicePosition {
  latitude: number;
  longitude: number;
  timestamp_utc: string;
  speed_kmh?: number;
}

/** Device as returned by `GET /api/devices` (docs/api-contract.md, §5). */
export interface Device {
  vehicle_id: string;
  display_name: string;
  status: DeviceStatus;
  tracking_enabled: boolean;
  source: string;
  last_position_at_utc: string | null;
  last_position: DevicePosition | null;
  region: string | null;
  trip_id: string | null;
}

/** Payload of the `DeviceStatusChanged` SignalR event (docs/api-contract.md, §6). */
export interface DeviceStatusChangedPayload {
  vehicle_id: string;
  status: DeviceStatus;
  previous_status: DeviceStatus;
  changed_at_utc: string;
  reason: string;
}

/**
 * Age of the last position after which a device becomes `PossiblyOffline`.
 * Mirrors the backend timeout detection (> 3 minutes without a position,
 * docs/api-contract.md, §7) so the UI stays consistent between server events.
 */
export const POSSIBLY_OFFLINE_AFTER_MS = 3 * 60 * 1000;

/** Age of the last position after which a device is considered `Offline`. */
export const OFFLINE_AFTER_MS = 30 * 60 * 1000;

/**
 * Derives a device status from the timestamp of its last known position.
 *
 * @param lastPositionAtUtc - ISO-8601 UTC timestamp of the last position, or `null`.
 * @param nowMs - Current time in epoch milliseconds (injectable for tests).
 * @returns `Online` (fresh), `PossiblyOffline` (3–30 minutes old) or `Offline`
 * (stale or never reported).
 */
export function deriveDeviceStatus(
  lastPositionAtUtc: string | null,
  nowMs: number = Date.now(),
): DeviceStatus {
  if (lastPositionAtUtc === null) {
    return 'Offline';
  }
  const lastMs = Date.parse(lastPositionAtUtc);
  if (Number.isNaN(lastMs)) {
    return 'Offline';
  }
  const age = nowMs - lastMs;
  if (age <= POSSIBLY_OFFLINE_AFTER_MS) {
    return 'Online';
  }
  if (age <= OFFLINE_AFTER_MS) {
    return 'PossiblyOffline';
  }
  return 'Offline';
}

/**
 * Merges a live `PositionReceived` event into the device list.
 *
 * Existing devices get their position, source and derived status refreshed;
 * unknown vehicles (for example a tracker that reported for the first time)
 * are appended with a minimal record keyed by the vehicle id.
 *
 * @param devices - Current device list.
 * @param event - Position event received over SignalR.
 * @returns A new device array (input array is never mutated).
 */
export function applyPositionEvent(devices: Device[], event: PositionEvent): Device[] {
  const position: DevicePosition = {
    latitude: event.latitude,
    longitude: event.longitude,
    timestamp_utc: event.timestamp_utc,
    ...(event.speed_kmh !== undefined && event.speed_kmh !== null
      ? { speed_kmh: event.speed_kmh }
      : {}),
  };
  const index = devices.findIndex((device) => device.vehicle_id === event.vehicle_id);
  if (index === -1) {
    const created: Device = {
      vehicle_id: event.vehicle_id,
      display_name: event.vehicle_id,
      status: 'Online',
      tracking_enabled: true,
      source: event.source,
      last_position_at_utc: event.timestamp_utc,
      last_position: position,
      region: null,
      trip_id: event.trip_id ?? null,
    };
    return [...devices, created];
  }
  const next = [...devices];
  const existing = next[index];
  next[index] = {
    ...existing,
    source: event.source,
    last_position_at_utc: event.timestamp_utc,
    last_position: position,
    status: deriveDeviceStatus(event.timestamp_utc),
    trip_id: event.trip_id ?? existing.trip_id,
  };
  return next;
}

/**
 * Applies a `DeviceStatusChanged` event to the device list.
 *
 * @param devices - Current device list.
 * @param payload - Status-change payload received over SignalR.
 * @returns A new device array; unknown vehicles are left untouched.
 */
export function applyStatusChanged(
  devices: Device[],
  payload: DeviceStatusChangedPayload,
): Device[] {
  return devices.map((device) =>
    device.vehicle_id === payload.vehicle_id
      ? { ...device, status: payload.status }
      : device,
  );
}
