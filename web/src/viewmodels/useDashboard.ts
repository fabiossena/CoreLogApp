/**
 * ViewModel of the Dashboard page (MVVM: the hook is the View-Model — it
 * exposes observable state and commands, while the page only renders).
 *
 * Responsibilities:
 * - Load and merge the device list (REST + live `PositionReceived` events).
 * - Track the connection state of the SignalR hub.
 * - Maintain the panic banner state: panics are shown until the operator
 *   acknowledges them (`POST /api/panic/{id}/ack`), and can only be
 *   dismissed after acknowledgement.
 *
 * Dependencies are injected as interfaces (`ICoreLogClient`,
 * `ITrackingRealtime`) — Dependency Inversion keeps this hook fully testable
 * with mocked clients.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyPositionEvent,
  applyStatusChanged,
  type Device,
} from '../domain/entities/Device';
import {
  mergePanicReceived,
  type PanicEvent,
  type PanicQuery,
} from '../domain/entities/PanicEvent';
import type { ICoreLogClient } from '../data/api/CoreLogClient';
import type { ConnectionState, ITrackingRealtime } from '../realtime/SignalRClient';

/** Public surface of the dashboard viewmodel (what the view consumes). */
export interface DashboardViewModel {
  /** Merged device list (REST snapshot + live position/status events). */
  devices: Device[];
  /** Unacknowledged panics fetched at startup, plus live `PanicReceived` ones. */
  pendingPanics: PanicEvent[];
  /** Result of the last `loadPanics` call (used by the PanicEvents page). */
  panicEvents: PanicEvent[];
  /** Panic ids acknowledged during this session (banner shows a dismiss action). */
  acknowledgedPanicIds: ReadonlySet<string>;
  /** Panic ids the operator dismissed (removed from the banner). */
  hiddenPanicIds: ReadonlySet<string>;
  /** Panic ids whose acknowledgement request is in flight. */
  acknowledgingPanicIds: ReadonlySet<string>;
  /** Panics currently displayed by the banner. */
  activePanics: PanicEvent[];
  /** `true` while the initial load is running. */
  isLoading: boolean;
  /** Last load/command error message (English), or `null`. */
  error: string | null;
  /** SignalR connection state. */
  connectionState: ConnectionState;
  /** Loads panics with arbitrary filters into `panicEvents`. */
  loadPanics(query?: PanicQuery): Promise<void>;
  /** Acknowledges a panic through CoreLog; required before dismissal. */
  acknowledgePanic(panicId: string): Promise<void>;
  /** Hides an (already acknowledged) panic from the banner. */
  hidePanic(panicId: string): void;
  /** Reloads devices and pending panics. */
  refresh(): Promise<void>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the dashboard viewmodel.
 *
 * @param api - CoreLog REST client (interface, injectable/mockable).
 * @param realtime - SignalR hub client (interface, injectable/mockable).
 * @param operator - Operator identity sent when acknowledging panics.
 * @returns The live dashboard viewmodel.
 */
export function useDashboard(
  api: ICoreLogClient,
  realtime: ITrackingRealtime,
  operator: string,
): DashboardViewModel {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pendingPanics, setPendingPanics] = useState<PanicEvent[]>([]);
  const [panicEvents, setPanicEvents] = useState<PanicEvent[]>([]);
  const [acknowledgedPanicIds, setAcknowledgedPanicIds] = useState<ReadonlySet<string>>(
    new Set<string>(),
  );
  const [hiddenPanicIds, setHiddenPanicIds] = useState<ReadonlySet<string>>(new Set<string>());
  const [acknowledgingPanicIds, setAcknowledgingPanicIds] = useState<ReadonlySet<string>>(
    new Set<string>(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    realtime.getConnectionState(),
  );

  const mountedRef = useRef(false);

  /** Loads devices plus the unacknowledged panics (banner source). */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [deviceList, panicList] = await Promise.all([
        api.getDevices(),
        api.getPanics({ acknowledged: false }),
      ]);
      if (!mountedRef.current) {
        return;
      }
      setDevices(deviceList);
      setPendingPanics((previous) => {
        const merged = [...panicList];
        for (const panic of previous) {
          if (!merged.some((item) => item.panic_id === panic.panic_id)) {
            merged.push(panic);
          }
        }
        return merged;
      });
      setError(null);
    } catch (loadError) {
      if (mountedRef.current) {
        setError(toMessage(loadError));
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [api]);

  /** {@inheritDoc DashboardViewModel.loadPanics} */
  const loadPanics = useCallback(
    async (query?: PanicQuery): Promise<void> => {
      try {
        const items = await api.getPanics(query ?? { acknowledged: false });
        if (!mountedRef.current) {
          return;
        }
        setPanicEvents(items);
        setError(null);
      } catch (loadError) {
        if (mountedRef.current) {
          setError(toMessage(loadError));
        }
      }
    },
    [api],
  );

  /** {@inheritDoc DashboardViewModel.acknowledgePanic} */
  const acknowledgePanic = useCallback(
    async (panicId: string): Promise<void> => {
      setAcknowledgingPanicIds((previous) => new Set(previous).add(panicId));
      try {
        const updated = await api.acknowledgePanic(panicId, { operator });
        if (!mountedRef.current) {
          return;
        }
        setPendingPanics((previous) =>
          previous.map((panic) => (panic.panic_id === panicId ? updated ?? panic : panic)),
        );
        setPanicEvents((previous) =>
          previous.map((panic) => (panic.panic_id === panicId ? updated ?? panic : panic)),
        );
        setAcknowledgedPanicIds((previous) => new Set(previous).add(panicId));
        setError(null);
      } catch (ackError) {
        if (mountedRef.current) {
          setError(toMessage(ackError));
        }
      } finally {
        if (mountedRef.current) {
          setAcknowledgingPanicIds((previous) => {
            const next = new Set(previous);
            next.delete(panicId);
            return next;
          });
        }
      }
    },
    [api, operator],
  );

  /** {@inheritDoc DashboardViewModel.hidePanic} */
  const hidePanic = useCallback((panicId: string): void => {
    setHiddenPanicIds((previous) => new Set(previous).add(panicId));
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const unsubscribers = [
      realtime.onPositionReceived((event) => {
        if (mountedRef.current) {
          setDevices((previous) => applyPositionEvent(previous, event));
        }
      }),
      realtime.onDeviceStatusChanged((payload) => {
        if (mountedRef.current) {
          setDevices((previous) => applyStatusChanged(previous, payload));
        }
      }),
      realtime.onPanicReceived((payload) => {
        if (mountedRef.current) {
          setPendingPanics((previous) => mergePanicReceived(previous, payload));
        }
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
    void refresh();

    return () => {
      mountedRef.current = false;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [realtime, refresh]);

  const activePanics = useMemo(
    () => pendingPanics.filter((panic) => !hiddenPanicIds.has(panic.panic_id)),
    [pendingPanics, hiddenPanicIds],
  );

  return {
    devices,
    pendingPanics,
    panicEvents,
    acknowledgedPanicIds,
    hiddenPanicIds,
    acknowledgingPanicIds,
    activePanics,
    isLoading,
    error,
    connectionState,
    loadPanics,
    acknowledgePanic,
    hidePanic,
    refresh,
  };
}
