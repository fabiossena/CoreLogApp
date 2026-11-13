/**
 * Command center page: tracker registration, bulk commands and command
 * history. All actions are executed by the `useCommandCenter` viewmodel and
 * go through CoreLog — the dashboard never talks to devices directly.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { useContainer } from '../../di/container';
import { useCommandCenter, type CommandCenterViewModel } from '../../viewmodels/useCommandCenter';
import type { DeviceStatus } from '../../domain/entities/Device';
import {
  TRACKER_CREDENTIAL_FIELDS,
  TRACKER_TYPES,
  type TrackerType,
} from '../../domain/entities/Tracker';
import type { CommandType } from '../../domain/entities/Command';
import { buildCommandRequest } from '../../domain/entities/Command';

/** Bulk-command type options rendered in the form. */
const BULK_COMMAND_TYPES: CommandType[] = [
  'SET_FREQUENCY',
  'SILENCE',
  'REACTIVATE',
  'REQUEST_IMMEDIATE_POSITION',
];

/** Status filter options. */
const STATUS_OPTIONS: Array<DeviceStatus | 'All'> = ['All', 'Online', 'PossiblyOffline', 'Offline'];

/** Props of the nested {@link BulkCommandPanel}. */
interface BulkCommandPanelProps {
  /** Viewmodel providing filters, targets and the bulk dispatch command. */
  center: CommandCenterViewModel;
  /** Known regions (derived from the device list). */
  regions: string[];
}

/**
 * Fleet filter + bulk command form. Local state here is pure view state
 * (selected command type and payload values).
 */
function BulkCommandPanel({ center, regions }: BulkCommandPanelProps) {
  const [commandType, setCommandType] = useState<CommandType>('SET_FREQUENCY');
  const [seconds, setSeconds] = useState(30);
  const [durationSeconds, setDurationSeconds] = useState(600);
  const [commandError, setCommandError] = useState<string | null>(null);

  function sendBulk(): void {
    setCommandError(null);
    try {
      const request =
        commandType === 'SET_FREQUENCY'
          ? buildCommandRequest(commandType, { seconds })
          : commandType === 'SILENCE'
            ? buildCommandRequest(commandType, { durationSeconds })
            : buildCommandRequest(commandType);
      void center.sendBulkCommand(request);
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div>
      <div className="filters">
        <label>
          Region
          <select
            value={center.filters.region ?? ''}
            onChange={(event) => center.setFilters({ region: event.target.value })}
          >
            <option value="">All regions</option>
            {regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={center.filters.status ?? 'All'}
            onChange={(event) =>
              center.setFilters({ status: event.target.value as DeviceStatus | 'All' })
            }
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Trip id
          <input
            type="text"
            placeholder="Any trip"
            value={center.filters.tripId ?? ''}
            onChange={(event) => center.setFilters({ tripId: event.target.value })}
          />
        </label>
      </div>

      <p>
        Target devices: <strong>{center.filteredDevices.length}</strong> of {center.devices.length}
      </p>

      <div className="filters">
        <label>
          Command
          <select
            value={commandType}
            onChange={(event) => setCommandType(event.target.value as CommandType)}
          >
            {BULK_COMMAND_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        {commandType === 'SET_FREQUENCY' ? (
          <label>
            Interval (seconds)
            <input
              type="number"
              min={1}
              value={seconds}
              onChange={(event) => setSeconds(Number(event.target.value))}
            />
          </label>
        ) : null}
        {commandType === 'SILENCE' ? (
          <label>
            Duration (seconds)
            <input
              type="number"
              min={1}
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(Number(event.target.value))}
            />
          </label>
        ) : null}
        <button type="button" onClick={sendBulk}>
          Send to {center.filteredDevices.length} device(s)
        </button>
      </div>

      {commandError !== null ? (
        <p className="error-banner" role="alert">
          {commandError}
        </p>
      ) : null}

      {center.bulkResults.length > 0 ? (
        <table className="device-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Status</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {center.bulkResults.map((result) => (
              <tr key={result.device_id}>
                <td>{result.device_id}</td>
                <td>
                  <span className={`badge badge--${result.status.toLowerCase()}`}>
                    {result.status}
                  </span>
                </td>
                <td>{result.error ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

/**
 * Renders the command center page.
 *
 * @returns The command center page (registration, bulk commands, history).
 */
export function CommandCenterPage() {
  const { api, realtime } = useContainer();
  const center = useCommandCenter(api, realtime);

  // --- Tracker registration form state -----------------------------------
  const [trackerType, setTrackerType] = useState<TrackerType>('Sascar');
  const [trackerName, setTrackerName] = useState('');
  const [trackerVehicleId, setTrackerVehicleId] = useState('');
  const [pollingInterval, setPollingInterval] = useState(30);
  const [trackerEnabled, setTrackerEnabled] = useState(true);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [registrationErrors, setRegistrationErrors] = useState<string[]>([]);
  const [registrationMessage, setRegistrationMessage] = useState<string | null>(null);

  const credentialFields = TRACKER_CREDENTIAL_FIELDS[trackerType];
  const regions = useMemo(
    () => [
      ...new Set(
        center.devices
          .map((device) => device.region)
          .filter((region): region is string => region !== null && region !== ''),
      ),
    ],
    [center.devices],
  );

  async function submitTracker(event: FormEvent): Promise<void> {
    event.preventDefault();
    setRegistrationErrors([]);
    setRegistrationMessage(null);
    const outcome = await center.registerTracker({
      type: trackerType,
      name: trackerName,
      vehicle_id: trackerVehicleId,
      polling_interval_seconds: pollingInterval,
      credentials,
      enabled: trackerEnabled,
    });
    if (outcome.ok && outcome.tracker !== null) {
      setRegistrationMessage(
        `Tracker registered: ${outcome.tracker.tracker_id} (${outcome.tracker.type} → ${outcome.tracker.vehicle_id}).`,
      );
      setTrackerName('');
      setTrackerVehicleId('');
      setCredentials({});
    } else {
      setRegistrationErrors(outcome.errors);
    }
  }

  return (
    <section className="page">
      <header className="page__header">
        <h1>Command center</h1>
        <span className={`connection connection--${center.connectionState.toLowerCase()}`}>
          SignalR: {center.connectionState}
        </span>
      </header>

      {center.error !== null ? (
        <p className="error-banner" role="alert">
          {center.error}
        </p>
      ) : null}

      <div className="dashboard-grid">
        {/* --- Tracker registration ------------------------------------- */}
        <div className="panel">
          <h2>Register tracker</h2>
          <form className="stacked-form" onSubmit={(event) => void submitTracker(event)}>
            <label>
              Type
              <select
                value={trackerType}
                onChange={(event) => {
                  setTrackerType(event.target.value as TrackerType);
                  setCredentials({});
                }}
              >
                {TRACKER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input
                type="text"
                value={trackerName}
                required
                placeholder="Fleet A — plate 12-AB-34"
                onChange={(event) => setTrackerName(event.target.value)}
              />
            </label>
            <label>
              Vehicle id
              <input
                type="text"
                value={trackerVehicleId}
                required
                placeholder="VEH-010"
                onChange={(event) => setTrackerVehicleId(event.target.value)}
              />
            </label>
            <label>
              Polling interval (seconds)
              <input
                type="number"
                min={1}
                value={pollingInterval}
                onChange={(event) => setPollingInterval(Number(event.target.value))}
              />
            </label>

            <fieldset>
              <legend>{trackerType} credentials</legend>
              {credentialFields.map((field) => (
                <label key={field.name}>
                  {field.label}
                  <input
                    type={field.input}
                    required={field.required}
                    value={credentials[field.name] ?? ''}
                    onChange={(event) =>
                      setCredentials((previous) => ({
                        ...previous,
                        [field.name]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </fieldset>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={trackerEnabled}
                onChange={(event) => setTrackerEnabled(event.target.checked)}
              />
              Enabled
            </label>

            <button type="submit">Register tracker</button>
          </form>

          {registrationErrors.length > 0 ? (
            <ul className="error-list" role="alert">
              {registrationErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
          {registrationMessage !== null ? (
            <p className="success-message">{registrationMessage}</p>
          ) : null}

          <h3>Registered trackers</h3>
          {center.isLoading ? (
            <p className="empty-state">Loading trackers…</p>
          ) : center.trackers.length === 0 ? (
            <p className="empty-state">No trackers registered yet.</p>
          ) : (
            <table className="device-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Vehicle</th>
                  <th>Polling (s)</th>
                  <th>Enabled</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {center.trackers.map((tracker) => (
                  <tr key={tracker.tracker_id}>
                    <td>{tracker.name}</td>
                    <td>{tracker.type}</td>
                    <td>{tracker.vehicle_id}</td>
                    <td>{tracker.polling_interval_seconds}</td>
                    <td>{tracker.enabled ? 'Yes' : 'No'}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void center.removeTracker(tracker.tracker_id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* --- Bulk commands -------------------------------------------- */}
        <div className="panel">
          <h2>Bulk commands</h2>
          <BulkCommandPanel center={center} regions={regions} />
        </div>
      </div>

      {/* --- Command history --------------------------------------------- */}
      <div className="panel">
        <h2>Command history</h2>
        <label className="inline-field">
          Device
          <select
            value={center.historyDeviceId ?? ''}
            onChange={(event) => {
              if (event.target.value !== '') {
                void center.loadHistory(event.target.value);
              }
            }}
          >
            <option value="">Select a device…</option>
            {center.devices.map((device) => (
              <option key={device.vehicle_id} value={device.vehicle_id}>
                {device.display_name} ({device.vehicle_id})
              </option>
            ))}
          </select>
        </label>

        {center.history.length === 0 ? (
          <p className="empty-state">
            {center.historyDeviceId === null
              ? 'Select a device to load its command history.'
              : 'No commands recorded for this device.'}
          </p>
        ) : (
          <table className="device-table">
            <thead>
              <tr>
                <th>Command</th>
                <th>Status</th>
                <th>Created</th>
                <th>Acknowledged</th>
                <th>Silenced until</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {center.history.map((command) => (
                <tr key={command.command_id}>
                  <td>
                    {command.command_type}
                    <br />
                    <span className="muted">{JSON.stringify(command.payload)}</span>
                  </td>
                  <td>
                    <span className={`badge badge--${command.status.toLowerCase()}`}>
                      {command.status}
                    </span>
                  </td>
                  <td>{command.created_at_utc}</td>
                  <td>{command.acknowledged_at_utc ?? '—'}</td>
                  <td>{command.silenced_until_utc ?? '—'}</td>
                  <td>{command.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default CommandCenterPage;
