/**
 * Panic event domain entity.
 *
 * Mirrors the `POST /api/panic` body of the CoreLog API contract
 * (`docs/api-contract.md`, section 2) using camelCase identifiers.
 */
import {Position} from './Position';

/** Fixed source tag required by the CoreLog panic contract. */
export const PANIC_SOURCE = 'MobileApp' as const;

/** A panic raised from the mobile app. */
export interface PanicEvent {
  /** Client-generated unique id of this panic (`event_id` on the wire). */
  eventId: string;
  /** Vehicle raising the panic (`vehicle_id` on the wire). */
  vehicleId: string;
  /** ISO-8601 UTC moment the panic button was pressed. */
  timestampUtc: string;
  /** Most recent known position, or `null` when none is available yet. */
  lastKnownPosition: Position | null;
  /** Always `MobileApp` for panics raised by this app. */
  source: typeof PANIC_SOURCE;
}

/**
 * Builds a {@link PanicEvent} with the fixed contract source tag.
 *
 * @param input - event identifiers and optional last known position.
 * @returns the panic event ready to be serialized by the data layer.
 */
export function createPanicEvent(input: {
  eventId: string;
  vehicleId: string;
  timestampUtc: string;
  lastKnownPosition: Position | null;
}): PanicEvent {
  return {...input, source: PANIC_SOURCE};
}
