/**
 * Panic events page: filterable list of panic events with acknowledgement.
 *
 * Filters: acknowledgement state (all / pending / acknowledged) and a time
 * range. Each entry shows the device, its last known position and the
 * timestamp, plus an Acknowledge button that posts to CoreLog.
 */

import { useEffect, useMemo, useState } from 'react';
import { useContainer } from '../../di/container';
import { useDashboard } from '../../viewmodels/useDashboard';
import type { PanicEvent, PanicQuery } from '../../domain/entities/PanicEvent';

/** Acknowledgement filter options. */
type AckFilter = 'all' | 'pending' | 'acknowledged';

function toIsoOrNull(value: string): string | undefined {
  if (value === '') {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * Renders the panic events page.
 *
 * @returns The panic events page.
 */
export function PanicEventsPage() {
  const { api, realtime, config } = useContainer();
  const dashboard = useDashboard(api, realtime, config.operator);
  const { loadPanics, panicEvents } = dashboard;

  const [ackFilter, setAckFilter] = useState<AckFilter>('pending');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const query = useMemo<PanicQuery>(() => {
    const next: PanicQuery = {};
    if (ackFilter !== 'all') {
      next.acknowledged = ackFilter === 'acknowledged';
    }
    const fromUtc = toIsoOrNull(from);
    if (fromUtc !== undefined) {
      next.from = fromUtc;
    }
    const toUtc = toIsoOrNull(to);
    if (toUtc !== undefined) {
      next.to = toUtc;
    }
    return next;
  }, [ackFilter, from, to]);

  useEffect(() => {
    void loadPanics(query);
  }, [loadPanics, query]);

  async function acknowledge(panic: PanicEvent): Promise<void> {
    await dashboard.acknowledgePanic(panic.panic_id);
    await loadPanics(query);
  }

  const isAcknowledged = (panic: PanicEvent): boolean =>
    panic.acknowledged || dashboard.acknowledgedPanicIds.has(panic.panic_id);

  return (
    <section className="page">
      <header className="page__header">
        <h1>Panic events</h1>
      </header>

      {dashboard.error !== null ? (
        <p className="error-banner" role="alert">
          {dashboard.error}
        </p>
      ) : null}

      <div className="panel filters">
        <label>
          Acknowledgement
          <select value={ackFilter} onChange={(event) => setAckFilter(event.target.value as AckFilter)}>
            <option value="pending">Pending</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          From
          <input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>

      {panicEvents.length === 0 ? (
        <p className="empty-state">No panic events match the current filters.</p>
      ) : (
        <table className="device-table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Timestamp (UTC)</th>
              <th>Last known position</th>
              <th>Source</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {panicEvents.map((panic) => {
              const acknowledged = isAcknowledged(panic);
              const inFlight = dashboard.acknowledgingPanicIds.has(panic.panic_id);
              const position = panic.last_known_position;
              return (
                <tr key={panic.panic_id}>
                  <td>
                    <strong>{panic.vehicle_id}</strong>
                    <br />
                    <span className="muted">{panic.panic_id}</span>
                  </td>
                  <td>{panic.timestamp_utc}</td>
                  <td>
                    {position !== null && position !== undefined
                      ? `${position.latitude}, ${position.longitude}`
                      : '—'}
                  </td>
                  <td>{panic.source}</td>
                  <td>
                    <span className={`badge badge--${acknowledged ? 'online' : 'warn'}`}>
                      {acknowledged
                        ? `Acknowledged${panic.acknowledged_by !== null ? ` by ${panic.acknowledged_by}` : ''}`
                        : 'Pending'}
                    </span>
                  </td>
                  <td>
                    {acknowledged ? (
                      <span className="muted">No action required</span>
                    ) : (
                      <button
                        type="button"
                        disabled={inFlight}
                        onClick={() => void acknowledge(panic)}
                      >
                        {inFlight ? 'Acknowledging…' : 'Acknowledge'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default PanicEventsPage;
