/**
 * Position domain entity.
 *
 * Domain-side identifiers are camelCase; conversion to the snake_case wire
 * format (`vehicle_id`, `timestamp_utc`, ...) happens in the data/infrastructure
 * layer so this entity stays transport-agnostic.
 */

/** A single recorded position of a tracked vehicle. */
export interface Position {
  /** Vehicle this position belongs to (`vehicle_id` on the wire). */
  vehicleId: string;
  /** WGS-84 latitude in degrees. */
  latitude: number;
  /** WGS-84 longitude in degrees. */
  longitude: number;
  /** ISO-8601 UTC timestamp of the sample, e.g. `2026-11-12T11:20:00Z`. */
  timestampUtc: string;
  /** Optional speed in km/h (`speed_kmh` on the wire). */
  speedKmh?: number;
}

/**
 * Type guard for values that look like a {@link Position}.
 *
 * @param value - value to check.
 * @returns `true` when `value` carries a usable position payload.
 */
export function isPosition(value: unknown): value is Position {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Position>;
  return (
    typeof candidate.vehicleId === 'string' &&
    typeof candidate.latitude === 'number' &&
    typeof candidate.longitude === 'number' &&
    typeof candidate.timestampUtc === 'string' &&
    (candidate.speedKmh === undefined || typeof candidate.speedKmh === 'number')
  );
}
