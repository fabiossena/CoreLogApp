/**
 * Dashboard page: live device list + map + panic banner.
 *
 * The page is a pure view: it wires the `useDashboard` viewmodel to the
 * presentational components and never talks to the network itself.
 */

import { useContainer } from '../../di/container';
import { useDashboard } from '../../viewmodels/useDashboard';
import { DeviceList } from '../components/DeviceList';
import { DeviceMap, type MapPoint } from '../components/DeviceMap';
import { PanicAlertBanner } from '../components/PanicAlertBanner';

/**
 * Renders the dashboard.
 *
 * @returns The dashboard page (panic banner, connection state, map, devices).
 */
export function DashboardPage() {
  const { api, realtime, config } = useContainer();
  const dashboard = useDashboard(api, realtime, config.operator);

  const mapPoints: MapPoint[] = dashboard.devices
    .filter((device) => device.last_position !== null)
    .map((device) => ({
      vehicle_id: device.vehicle_id,
      label: device.display_name,
      latitude: device.last_position!.latitude,
      longitude: device.last_position!.longitude,
      status: device.status,
    }));

  return (
    <section className="page">
      <PanicAlertBanner
        panics={dashboard.activePanics}
        acknowledgedPanicIds={dashboard.acknowledgedPanicIds}
        acknowledgingPanicIds={dashboard.acknowledgingPanicIds}
        onAcknowledge={dashboard.acknowledgePanic}
        onHide={dashboard.hidePanic}
      />

      <header className="page__header">
        <h1>Fleet dashboard</h1>
        <div className="page__header-actions">
          <span className={`connection connection--${dashboard.connectionState.toLowerCase()}`}>
            SignalR: {dashboard.connectionState}
          </span>
          <button type="button" onClick={() => void dashboard.refresh()}>
            Refresh
          </button>
        </div>
      </header>

      {dashboard.error !== null ? (
        <p className="error-banner" role="alert">
          {dashboard.error}
        </p>
      ) : null}

      {dashboard.isLoading ? <p className="empty-state">Loading devices…</p> : null}

      <div className="dashboard-grid">
        <div className="panel">
          <h2>Devices</h2>
          <DeviceList devices={dashboard.devices} />
        </div>
        <div className="panel">
          <h2>Live positions</h2>
          <DeviceMap points={mapPoints} />
        </div>
      </div>
    </section>
  );
}

export default DashboardPage;
