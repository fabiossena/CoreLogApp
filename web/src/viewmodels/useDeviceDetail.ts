/**
 * ViewModel of the Device Detail page.
 *
 * Responsibilities:
 * - Current position, 24h trail and active-trip trail (REST through CoreLog).
 * - Live updates via the `device-{vehicleId}` SignalR group.
 * - Dispatching commands and awaiting `CommandAcked` with a timeout, so the
 *   UI can show a failed state when the device never acknowledges.
 *
 * All dependencies are injected interfaces (Dependency Inversion).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Device, DeviceStatus, PositionEvent } from '../domain/entities/Device';
import type { DispatchCommandRequest, Command } from '../domain/entities/Command';
import { CommandAckTracker } from '../domain/entities/Command';
import type { ICoreLogClient } from '../data/api/CoreLogClient';
import type { ConnectionState, ITrackingRealtime } from '../realtime/SignalRClient';

/** Configurable behaviour of the device-detail viewmodel. */
export interface DeviceDetailOptions {
  /** Trip id to load; defaults to the device's own `trip_id`. */
  tripId?: string;
  /** Milliseconds to wait for `CommandAcked` before marking a command failed. */
  ackTimeoutMs?: number;
  /** Clock used to compute the 24h window (injectable for tests). */
  now?: () => number;
}

/** Public surface of the device-detail viewmodel (what the view consumes). */
export interface DeviceDetailViewModel {
  /** Device record from `GET /api/devices`, or `null` while loading/unknown. */
  device: Device | null;
  /** Latest position from `GET /api/tracking/{vehicleId}/last`. */
  currentPosition: PositionEvent | null;
  /** Positions of the last 24 hours (newest last). */
  trail: PositionEvent[];
  /** Positions of the active trip, when a trip id is known. */
  tripPositions: PositionEvent[];
  /** Current status (device record or latest `DeviceStatusChanged`). */
  status: DeviceStatus | null;
  /** `true` while the initial load is running. */
  isLoading: boolean;
  /** Last error message (English), or `null`. */
  error: string | null;
  /** SignalR connection state. */
  connectionState: ConnectionState;
  /** Commands sent this session, with live delivery status. */
  sentCommands: Command[];
  /** `true` while a command dispatch is in flight. */
  isSendingCommand: boolean;
  /**
   * Dispatches a command through CoreLog and waits for `CommandAcked`.
   * Resolves with the terminal command state (`Acked`/`Failed`).
   */
  sendCommand(request: DispatchCommandRequest): Promise<Command | null>;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toIsoUtc(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Builds the device-detail viewmodel.
 *
 * @param api - CoreLog REST client (interface, injectable/mockable).
 * @param realtime - SignalR hub client (interface, injectable/mockable).
 * @param vehicleId - Vehicle to inspect (empty string = nothing to load).
 * @param options - Optional trip id, ack timeout and clock.
 * @returns The live device-detail viewmodel.
 */
export function useDeviceDetail(
  api: ICoreLogClient,
  realtime: ITrackingRealtime,
  vehicleId: string,
  options: DeviceDetailOptions = {},
): DeviceDetailViewModel {
  const { tripId: tripIdOption, ackTimeoutMs = 10_000, now = Date.now } = options;

  const [device, setDevice] = useState<Device | null>(null);
  const [currentPosition, setCurrentPosition] = useState<PositionEvent | null>(null);
  const [trail, setTrail] = useState<PositionEvent[]>([]);
  const [tripPositions, setTripPositions] = useState<PositionEvent[]>([]);
  const [isLoading, setIsLoading] = useState(vehicleId !== '');
  const [error, setError] = useState<string | null>(null);
  const [sentCommands, setSentCommands] = useState<Command[]>([]);
  const [isSendingCommand, setIsSendingCommand] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    realtime.getConnectionState(),
  );

  const mountedRef = useRef(false);
  const trackerRef = useRef<CommandAckTracker | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const tracker = new CommandAckTracker(ackTimeoutMs);
    trackerRef.current = tracker;

    if (vehicleId === '') {
      setIsLoading(false);
      return () => {
        mountedRef.current = false;
        tracker.clear();
        trackerRef.current = null;
      };
    }

    const unsubscribers = [
      realtime.onPositionReceived((event) => {
        if (!mountedRef.current || event.vehicle_id !== vehicleId) {
          return;
        }
        setCurrentPosition(event);
        setTrail((previous) =>
          previous.some((item) => item.event_id === event.event_id)
            ? previous
            : [...previous, event],
        );
      }),
      realtime.onDeviceStatusChanged((payload) => {
        if (!mountedRef.current || payload.vehicle_id !== vehicleId) {
          return;
        }
        setDevice((previous) => (previous ? { ...previous, status: payload.status } : previous));
      }),
      realtime.onCommandAcked((payload) => {
        tracker.handleAck(payload);
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
        await realtime.joinVehicle(vehicleId);
      } catch (connectionError) {
        if (mountedRef.current) {
          setError(toMessage(connectionError));
        }
      }
    })();

    void (async () => {
      try {
        const toUtc = now();
        const fromUtc = toUtc - 24 * 60 * 60 * 1000;
        const [deviceList, lastPosition, positions] = await Promise.all([
          api.getDevices(),
          api.getLastPosition(vehicleId),
          api.getPositions(vehicleId, toIsoUtc(fromUtc), toIsoUtc(toUtc)),
        ]);
        if (!mountedRef.current) {
          return;
        }
        setDevice(deviceList.find((item) => item.vehicle_id === vehicleId) ?? null);
        setCurrentPosition(lastPosition);
        setTrail(positions);
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
    })();

    return () => {
      mountedRef.current = false;
      tracker.clear();
      trackerRef.current = null;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [api, realtime, vehicleId, ackTimeoutMs, now]);

  /** Active trip: explicit option first, then the device's own trip. */
  const tripId = tripIdOption ?? device?.trip_id ?? null;

  useEffect(() => {
    if (tripId === null || tripId === '') {
      setTripPositions([]);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const positions = await api.getTripPositions(tripId);
        if (active) {
          setTripPositions(positions);
        }
      } catch (loadError) {
        if (active) {
          setError(toMessage(loadError));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [api, tripId]);

  /** {@inheritDoc DeviceDetailViewModel.sendCommand} */
  const sendCommand = useCallback(
    async (request: DispatchCommandRequest): Promise<Command | null> => {
      const tracker = trackerRef.current;
      if (vehicleId === '' || tracker === null) {
        return null;
      }
      setIsSendingCommand(true);
      try {
        const command = await api.dispatchCommand(vehicleId, request);
        if (!mountedRef.current) {
          return null;
        }
        setSentCommands((previous) => [command, ...previous]);
        const outcome = await tracker.track(command.command_id);
        const finalCommand: Command = {
          ...command,
          status: outcome.status,
          acknowledged_at_utc: outcome.acknowledged_at_utc,
          error: outcome.error,
        };
        if (mountedRef.current) {
          setSentCommands((previous) =>
            previous.map((item) =>
              item.command_id === finalCommand.command_id ? finalCommand : item,
            ),
          );
          setError(null);
        }
        return finalCommand;
      } catch (dispatchError) {
        if (mountedRef.current) {
          setError(toMessage(dispatchError));
        }
        return null;
      } finally {
        if (mountedRef.current) {
          setIsSendingCommand(false);
        }
      }
    },
    [api, vehicleId],
  );

  const status: DeviceStatus | null = device?.status ?? null;

  return {
    device,
    currentPosition,
    trail,
    tripPositions,
    status,
    isLoading,
    error,
    connectionState,
    sentCommands,
    isSendingCommand,
    sendCommand,
  };
}
