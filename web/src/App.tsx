/**
 * Application shell: composition root + routing.
 *
 * `App` creates the DI container once (via `createContainer`) and publishes
 * it through `ContainerContext`, so pages obtain the `ICoreLogClient` /
 * `ITrackingRealtime` abstractions and hand them to their viewmodel hooks.
 */

import { useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { ContainerContext, createContainer } from './di/container';
import DashboardPage from './presentation/pages/DashboardPage';
import DeviceDetailPage from './presentation/pages/DeviceDetailPage';
import PanicEventsPage from './presentation/pages/PanicEventsPage';
import CommandCenterPage from './presentation/pages/CommandCenterPage';

/** Navigation items rendered in the top bar. */
const NAV_ITEMS: Array<{ to: string; label: string }> = [
  { to: '/', label: 'Dashboard' },
  { to: '/panic', label: 'Panic events' },
  { to: '/commands', label: 'Command center' },
];

/**
 * Renders the application shell with routing.
 *
 * @returns The routed application.
 */
export default function App() {
  const [container] = useState(() => createContainer());

  return (
    <ContainerContext.Provider value={container}>
      <div className="app">
        <nav className="topnav">
          <span className="topnav__brand">CoreLog</span>
          {NAV_ITEMS.map((item) => (
            <Link key={item.to} to={item.to} className="topnav__link">
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="content">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/devices/:vehicleId" element={<DeviceDetailPage />} />
            <Route path="/panic" element={<PanicEventsPage />} />
            <Route path="/commands" element={<CommandCenterPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </ContainerContext.Provider>
  );
}
