/**
 * Device list — renders the dashboard's devices with live status, tracking
 * state, last position time and source. Pure presentational component:
 * everything it needs arrives through props from the viewmodel.
 */

import { Link } from 'react-router-dom';
import type { Device } from '../../domain/entities/Device';

/** Props of {@link DeviceList}. */
export interface DeviceListProps {
  /** Devices to render (already merged with live events by the viewmodel). */
  devices: Device[];
}

function statusClass(status: Device['status']): string {
  switch (status) {
    case 'Online':
      return 'badge badge--online';
    case 'PossiblyOffline':
      return 'badge badge--warn';
    default:
      return 'badge badge--offline';
  }
}

/**
 * Renders the fleet table.
 *
 * @param devices - Devices to render.
 * @returns The device list (or an empty-state message).
 */
export function DeviceList({ devices }: DeviceListProps) {
  if (devices.length === 0) {
    return <p className="empty-state">No devices to display yet.</p>;
  }

  return (
    <table className="device-table">
      <thead>
        <tr>
          <th>Vehicle</th>
          <th>Status</th>
          <th>Tracking</th>
          <th>Last position</th>
          <th>Source</th>
          <th>Region</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {devices.map((device) => (
          <tr key={device.vehicle_id}>
            <td>
              <strong>{device.display_name}</strong>
              <br />
              <span className="muted">{device.vehicle_id}</span>
            </td>
            <td>
              <span className={statusClass(device.status)}>{device.status}</span>
            </td>
            <td>{device.tracking_enabled ? 'ON' : 'OFF'}</td>
            <td>{device.last_position_at_utc ?? '—'}</td>
            <td>{device.source}</td>
            <td>{device.region ?? '—'}</td>
            <td>
              <Link to={`/devices/${encodeURIComponent(device.vehicle_id)}`}>Details</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
