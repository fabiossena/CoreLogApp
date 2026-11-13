/**
 * ViewModel of the Command Center page.
 *
 * Responsibilities:
 * - Register/delete trackers through CoreLog's admin API, with per-type
 *   credential validation driven by `TRACKER_CREDENTIAL_FIELDS`.
 * - Bulk commands: filter the fleet by region / status / trip and dispatch a
 *   command to every matching device, tracking each `CommandAcked` (or
 *   timeout) individually.
 * - Command history per device with delivery status.
 *
 * All dependencies are injected interfaces (Dependency Inversion).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Device, DeviceStatus } from '../domain/entities/Device';
import type {
  Command,
  CommandAckedPayload,
  DispatchCommandRequest,
} from '../domain/entities/Command';
import { CommandAckTracker } from '../domain/entities/Command';
import type {
  RegisterTrackerRequest,
  RegisterTrackerResponse,
  Tracker,
} from '../domain/entities/Tracker';
import { validateTrackerCredentials } from '../domain/entities/Tracker';
import type { ICoreLogClient } from '../data/api/CoreLogClient';
import type { ConnectionState, ITrackingRealtime } from '../realtime/SignalRClient';

/** Filters applied to the fleet before a bulk command. */
export interface BulkCommandFilters {
  /** Region exact match (`Porto`, `Lisbon`, ...); empty = all regions. */
  region?: string;
  /** Device status; `'All'` (default) = no status filtering. */
  status?: DeviceStatus | 'All';
  /** Trip id exact match; empty = all trips. */
  tripId?: string;
}

/** Delivery outcome of one device targeted by a bulk command. */
export interface BulkCommandResult {
  device_id: string;
  status: 'Pending' | 'Acked' | 'Failed';
  error: string | null;
}

/** Outcome of a tracker registration attempt. */
export interface RegisterTrackerOutcome {
  ok: boolean;
  /** English validation/error messages (empty when `ok`). */
  errors: string[];
  /** Created tracker (only when `ok`). */
  tracker: RegisterTrackerResponse | null;
}

/** Public surface of the command-center viewmodel. */
export interface CommandCenterViewModel {
  /** Devices used to resolve bulk-command targets. */
  devices: Device[];
  /** Registered trackers. */
  trackers: Tracker[];
  /** Command history of `historyDeviceId`. */
  history: Command[];
  /** Device whose history is loaded, or `null`. */
  historyDeviceId: string | null;
  /** Current bulk-command filters. */
  filters: BulkCommandFilters;
  /** Devices matching `filters` (bulk-command targets). */
  filteredDevices: Device[];
  /** Per-device outcomes of the last bulk command. */
  bulkResults: BulkCommandResult[];
  /** `true` while the initial load is running. */
  isLoading: boolean;
  /** Last error message (English), or `null`. */
  error: string | null;
  /** SignalR connection state. */
  connectionState: ConnectionState;
  /** Merges partial filter updates. */
  setFilters(next: BulkCommandFilters): void;
  /** Validates and registers a tracker, then refreshes the tracker list. */
  registerTracker(request: RegisterTrackerRequest): Promise<RegisterTrackerOutcome>;
  /** Deletes a tracker and refreshes the tracker list. */
  removeTracker(trackerId: string): Promise<void>;
  /** Loads the command history of one device. */
  loadHistory(deviceId: string): Promise<void>;
  /**
   * Dispatches a command to every device matching `filters` and awaits each
   * `CommandAcked` (timeout ⇒ `Failed`).
   */
  sendBulkCommand(request: DispatchCommandRequest): Promise<BulkCommandResult[]>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the command-center viewmodel.
 *
 * @param api - CoreLog REST client (interface, injectable/mockable).
 * @param realtime - SignalR hub client (interface, injectable/mockable).
 * @param options - Optional ack timeout for bulk commands.
 * @returns The live command-center viewmodel.
 */
export function useCommandCenter(
  api: ICoreLogClient,
  realtime: ITrackingRealtime,
  options: { ackTimeoutMs?: number } = {},
): CommandCenterViewModel {
  const { ackTimeoutMs = 10_000 } = options;

  const [devices, setDevices] = useState<Device[]>([]);
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [history, setHistory] = useState<Command[]>([]);
  const [historyDeviceId, setHistoryDeviceId] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<BulkCommandFilters>({ status: 'All' });
  const [bulkResults, setBulkResults] = useState<BulkCommandResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    realtime.getConnectionState(),
  );

  const mountedRef = useRef(false);
  const trackerRef = useRef<CommandAckTracker | null>(null);

  const refreshDevices = useCallback(async (): Promise<void> => {
    try {
      const list = await api.getDevices();
      if (mountedRef.current) {
        setDevices(list);
        setError(null);
      }
    } catch (loadError) {
      if (mountedRef.current) {
        setError(toMessage(loadError));
      }
    }
  }, [api]);

  const refreshTrackers = useCallback(async (): Promise<void> => {
    try {
      const list = await api.listTrackers();
      if (mountedRef.current) {
        setTrackers(list);
        setError(null);
      }
    } catch (loadError) {
      if (mountedRef.current) {
        setError(toMessage(loadError));
      }
    }
  }, [api]);

  useEffect(() => {
    mountedRef.current = true;
    const tracker = new CommandAckTracker(ackTimeoutMs);
    trackerRef.current = tracker;

    const unsubscribers = [
      realtime.onCommandAcked((payload: CommandAckedPayload) => {
        tracker.handleAck(payload);
      }),
      realtime.onDeviceStatusChanged((payload) => {
        if (!mountedRef.current) {
          return;
        }
        setDevices((previous) =>
          previous.map((device) =>
            device.vehicle_id === payload.vehicle_id
              ? { ...device, status: payload.status }
              : device,
          ),
        );
      }),
      realtime.onConnectionStateChange((state) => {
        if (mountedRef.current) {
          setConnectionState(state);
        }
      }),
    ];
    setConnectionState(realtime.getConnectionState());

    void (async () => {
      try {
        await realtime.start();
        await realtime.joinAll();
      } catch (connectionError) {
        if (mountedRef.current) {
          setError(toMessage(connectionError));
        }
      }
    })();
    void (async () => {
      await Promise.all([refreshDevices(), refreshTrackers()]);
      if (mountedRef.current) {
        setIsLoading(false);
      }
    })();

    return () => {
      mountedRef.current = false;
      tracker.clear();
      trackerRef.current = null;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [realtime, ackTimeoutMs, refreshDevices, refreshTrackers]);

  /** {@inheritDoc CommandCenterViewModel.setFilters} */
  const setFilters = useCallback((next: BulkCommandFilters): void => {
    setFiltersState((previous) => ({ ...previous, ...next }));
  }, []);

  const filteredDevices = useMemo(() => {
    return devices.filter((device) => {
      if (filters.region !== undefined && filters.region !== '' && device.region !== filters.region) {
        return false;
      }
      if (filters.status !== undefined && filters.status !== 'All' && device.status !== filters.status) {
        return false;
      }
      if (filters.tripId !== undefined && filters.tripId !== '' && device.trip_id !== filters.tripId) {
        return false;
      }
      return true;
    });
  }, [devices, filters]);

  /** {@inheritDoc CommandCenterViewModel.registerTracker} */
  const registerTracker = useCallback(
    async (request: RegisterTrackerRequest): Promise<RegisterTrackerOutcome> => {
      const errors = validateTrackerCredentials(request.type, request.credentials);
      if (request.name.trim() === '') {
        errors.push('Tracker name is required.');
      }
      if (request.vehicle_id.trim() === '') {
        errors.push('Vehicle id is required.');
      }
      if (!Number.isFinite(request.polling_interval_seconds) || request.polling_interval_seconds <= 0) {
        errors.push('Polling interval must be a positive number of seconds.');
      }
      if (errors.length > 0) {
        return { ok: false, errors, tracker: null };
      }
      try {
        const created = await api.registerTracker(request);
        await refreshTrackers();
        if (mountedRef.current) {
          setError(null);
        }
        return { ok: true, errors: [], tracker: created };
      } catch (registerError) {
        const message = toMessage(registerError);
        if (mountedRef.current) {
          setError(message);
        }
        return { ok: false, errors: [message], tracker: null };
      }
    },
    [api, refreshTrackers],
  );

  /** {@inheritDoc CommandCenterViewModel.removeTracker} */
  const removeTracker = useCallback(
    async (trackerId: string): Promise<void> => {
      try {
        await api.deleteTracker(trackerId);
        await refreshTrackers();
      } catch (deleteError) {
        if (mountedRef.current) {
          setError(toMessage(deleteError));
        }
      }
    },
    [api, refreshTrackers],
  );

  /** {@inheritDoc CommandCenterViewModel.loadHistory} */
  const loadHistory = useCallback(
    async (deviceId: string): Promise<void> => {
      try {
        const items = await api.getCommandHistory(deviceId);
        if (mountedRef.current) {
          setHistory(items);
          setHistoryDeviceId(deviceId);
          setError(null);
        }
      } catch (historyError) {
        if (mountedRef.current) {
          setError(toMessage(historyError));
        }
      }
    },
    [api],
  );

  /** {@inheritDoc CommandCenterViewModel.sendBulkCommand} */
  const sendBulkCommand = useCallback(
    async (request: DispatchCommandRequest): Promise<BulkCommandResult[]> => {
      const tracker = trackerRef.current;
      const targets = filteredDevices;
      if (targets.length === 0) {
        const message = 'No devices match the current filters.';
        setError(message);
        return [];
      }
      if (tracker === null) {
        return [];
      }
      const pending: BulkCommandResult[] = targets.map((device) => ({
        device_id: device.vehicle_id,
        status: 'Pending',
        error: null,
      }));
      setBulkResults(pending);
      const results = await Promise.all(
        targets.map(async (device): Promise<BulkCommandResult> => {
          try {
            const command = await api.dispatchCommand(device.vehicle_id, request);
            const outcome = await tracker.track(command.command_id);
            return {
              device_id: device.vehicle_id,
              status: outcome.status,
              error: outcome.error,
            };
          } catch (dispatchError) {
            return {
              device_id: device.vehicle_id,
              status: 'Failed',
              error: toMessage(dispatchError),
            };
          }
        }),
      );
      if (mountedRef.current) {
        setBulkResults(results);
        setError(null);
      }
      return results;
    },
    [api, filteredDevices],
  );

  return {
    devices,
    trackers,
    history,
    historyDeviceId,
    filters,
    filteredDevices,
    bulkResults,
    isLoading,
    error,
    connectionState,
    setFilters,
    registerTracker,
    removeTracker,
    loadHistory,
    sendBulkCommand,
  };
}
