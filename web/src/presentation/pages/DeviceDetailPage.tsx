/**
 * Device detail page: current position, last-24h trail, active trip and
 * command buttons. Every command goes through CoreLog and the page shows its
 * delivery state until `CommandAcked` arrives (or the timeout marks it failed).
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useContainer } from '../../di/container';
import { useDeviceDetail } from '../../viewmodels/useDeviceDetail';
import { buildCommandRequest, type CommandType } from '../../domain/entities/Command';
import { DeviceMap, type MapPoint } from '../components/DeviceMap';

/** Command buttons rendered on the page. */
const COMMAND_BUTTONS: Array<{ type: CommandType; label: string }> = [
  { type: 'SET_FREQUENCY', label: 'Set frequency (30s)' },
  { type: 'SILENCE', label: 'Silence (10 min)' },
  { type: 'REACTIVATE', label: 'Reactivate' },
  { type: 'REQUEST_IMMEDIATE_POSITION', label: 'Request immediate position' },
];

function buildRequest(type: CommandType) {
  switch (type) {
    case 'SET_FREQUENCY':
      return buildCommandRequest(type, { seconds: 30 });
    case 'SILENCE':
      return buildCommandRequest(type, { durationSeconds: 600 });
    default:
      return buildCommandRequest(type);
  }
}

/**
 * Renders the device detail page for `:vehicleId`.
 *
 * @returns The device detail page.
 */
export function DeviceDetailPage() {
  const params = useParams<{ vehicleId: string }>();
  const vehicleId = params.vehicleId ?? '';
  const { api, realtime } = useContainer();
  const detail = useDeviceDetail(api, realtime, vehicleId);
  const [commandError, setCommandError] = useState<string | null>(null);

  const current = detail.currentPosition;
  const mapPoints: MapPoint[] =
    current !== null
      ? [
          {
            vehicle_id: current.vehicle_id,
            label: detail.device?.display_name ?? current.vehicle_id,
            latitude: current.latitude,
            longitude: current.longitude,
            status: detail.status ?? undefined,
          },
        ]
      : [];
  const trailPoints: MapPoint[] = detail.trail.map((position) => ({
    vehicle_id: position.event_id,
    label: position.timestamp_utc,
    latitude: position.latitude,
    longitude: position.longitude,
  }));

  async function sendPreset(type: CommandType): Promise<void> {
    setCommandError(null);
    try {
      await detail.sendCommand(buildRequest(type));
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="page">
      <header className="page__header">
        <h1>{detail.device !== null ? detail.device.display_name : vehicleId || 'Device'}</h1>
        <span className={`connection connection--${detail.connectionState.toLowerCase()}`}>
          SignalR: {detail.connectionState}
        </span>
      </header>

      {detail.error !== null || commandError !== null ? (
        <p className="error-banner" role="alert">
          {detail.error ?? commandError}
        </p>
      ) : null}

      {detail.isLoading ? <p className="empty-state">Loading device…</p> : null}

      <div className="dashboard-grid">
        <div className="panel">
          <h2>Current position</h2>
          {current !== null ? (
            <dl className="facts">
              <dt>Latitude</dt>
              <dd>{current.latitude}</dd>
              <dt>Longitude</dt>
              <dd>{current.longitude}</dd>
              <dt>Timestamp</dt>
              <dd>{current.timestamp_utc}</dd>
              <dt>Speed</dt>
              <dd>{current.speed_kmh !== undefined && current.speed_kmh !== null ? `${current.speed_kmh} km/h` : '—'}</dd>
              <dt>Source</dt>
              <dd>{current.source}</dd>
              <dt>Status</dt>
              <dd>{detail.status ?? '—'}</dd>
              <dt>Tracking</dt>
              <dd>{detail.device !== null ? (detail.device.tracking_enabled ? 'ON' : 'OFF') : '—'}</dd>
            </dl>
          ) : (
            <p className="empty-state">No position recorded yet.</p>
          )}

          <h2>Active trip</h2>
          {detail.device?.trip_id != null && detail.device.trip_id !== '' ? (
            <p>
              Trip <code>{detail.device.trip_id}</code> — {detail.tripPositions.length} position
              {detail.tripPositions.length === 1 ? '' : 's'} loaded.
            </p>
          ) : (
            <p className="empty-state">No active trip.</p>
          )}
        </div>

        <div className="panel">
          <h2>Trail (last 24h)</h2>
          <DeviceMap points={mapPoints} trail={trailPoints} />
          <p className="muted">{detail.trail.length} positions in the last 24 hours.</p>
        </div>
      </div>

      <div className="panel">
        <h2>Commands</h2>
        <div className="command-buttons">
          {COMMAND_BUTTONS.map((button) => (
            <button
              key={button.type}
              type="button"
              disabled={detail.isSendingCommand}
              onClick={() => void sendPreset(button.type)}
            >
              {button.label}
            </button>
          ))}
        </div>

        {detail.sentCommands.length > 0 ? (
          <table className="command-table">
            <thead>
              <tr>
                <th>Command</th>
                <th>Status</th>
                <th>Created</th>
                <th>Acknowledged</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {detail.sentCommands.map((command) => (
                <tr key={command.command_id}>
                  <td>{command.command_type}</td>
                  <td>
                    <span className={`badge badge--${command.status.toLowerCase()}`}>
                      {command.status}
                    </span>
                  </td>
                  <td>{command.created_at_utc}</td>
                  <td>{command.acknowledged_at_utc ?? '—'}</td>
                  <td>{command.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty-state">No commands sent in this session.</p>
        )}
      </div>
    </section>
  );
}

export default DeviceDetailPage;
