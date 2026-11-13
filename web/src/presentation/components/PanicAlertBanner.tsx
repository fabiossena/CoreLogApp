/**
 * Panic alert banner — a loud, always-on-top alert for unacknowledged panic
 * events. It stays visible until the operator acknowledges each panic
 * (`POST /api/panic/{panicId}/ack`); only then does a "Dismiss" action
 * appear, so no distress signal can be silently closed.
 */

import type { PanicEvent } from '../../domain/entities/PanicEvent';

/** Props of {@link PanicAlertBanner}. */
export interface PanicAlertBannerProps {
  /** Panics currently shown (pending or acknowledged, never hidden). */
  panics: PanicEvent[];
  /** Ids acknowledged this session (these can be dismissed). */
  acknowledgedPanicIds: ReadonlySet<string>;
  /** Ids whose acknowledgement request is in flight (buttons disabled). */
  acknowledgingPanicIds: ReadonlySet<string>;
  /** Acknowledge command (posts the acknowledgement through CoreLog). */
  onAcknowledge: (panicId: string) => void | Promise<void>;
  /** Dismiss command (only offered after acknowledgement). */
  onHide: (panicId: string) => void;
}

/**
 * Renders the panic banner.
 *
 * @returns The banner, or `null` when there is nothing to alert about.
 */
export function PanicAlertBanner({
  panics,
  acknowledgedPanicIds,
  acknowledgingPanicIds,
  onAcknowledge,
  onHide,
}: PanicAlertBannerProps) {
  if (panics.length === 0) {
    return null;
  }

  return (
    <div className="panic-banner" role="alert" aria-live="assertive">
      <span className="panic-banner__icon" aria-hidden="true">
        ⚠
      </span>
      <div className="panic-banner__items">
        <strong className="panic-banner__title">
          PANIC — {panics.length} event{panics.length > 1 ? 's' : ''} require action
        </strong>
        {panics.map((panic) => {
          const acknowledged = acknowledgedPanicIds.has(panic.panic_id);
          const inFlight = acknowledgingPanicIds.has(panic.panic_id);
          const position = panic.last_known_position;
          return (
            <div className="panic-banner__item" key={panic.panic_id}>
              <span>
                <strong>{panic.vehicle_id}</strong> · {panic.timestamp_utc} · {panic.source}
              </span>
              <span className="muted">
                {position !== null && position !== undefined
                  ? `last known position ${position.latitude}, ${position.longitude}`
                  : 'position unknown'}
              </span>
              {acknowledged ? (
                <button type="button" onClick={() => onHide(panic.panic_id)}>
                  Acknowledged ✓ — Dismiss
                </button>
              ) : (
                <button
                  type="button"
                  className="panic-banner__ack"
                  disabled={inFlight}
                  onClick={() => {
                    void onAcknowledge(panic.panic_id);
                  }}
                >
                  {inFlight ? 'Acknowledging…' : 'Acknowledge'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
