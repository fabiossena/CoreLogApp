/**
 * Test doubles and fixtures for the dashboard test-suite.
 *
 * Everything here is in-memory: no network, no WebSocket, no map tiles.
 * `createApiMock` produces an object matching `ICoreLogClient`, and
 * `createRealtimeMock` matches `ITrackingRealtime` while letting tests emit
 * SignalR events as if the CoreLog hub had pushed them.
 */

import { vi } from 'vitest';
import type { ICoreLogClient } from '../../src/data/api/CoreLogClient';
import type { ITrackingRealtime, ConnectionState } from '../../src/realtime/SignalRClient';
import type { Device, DeviceStatusChangedPayload, PositionEvent } from '../../src/domain/entities/Device';
import type { PanicEvent, PanicQuery, PanicReceivedPayload } from '../../src/domain/entities/PanicEvent';
import type {
  Command,
  CommandAckedPayload,
  DispatchCommandRequest,
} from '../../src/domain/entities/Command';
import type {
  RegisterTrackerRequest,
  RegisterTrackerResponse,
  Tracker,
} from '../../src/domain/entities/Tracker';

/** Builds a device fixture (contract §5 shape). */
export function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    vehicle_id: 'VEH-001',
    display_name: 'Van 01',
    status: 'Online',
    tracking_enabled: true,
    source: 'MobileApp',
    last_position_at_utc: '2026-11-12T11:21:00Z',
    last_position: {
      latitude: 41.1496,
      longitude: -8.611,
      timestamp_utc: '2026-11-12T11:21:00Z',
      speed_kmh: 68.2,
    },
    region: 'Porto',
    trip_id: 'trip-1',
    ...overrides,
  };
}

/** Builds a pending panic fixture (contract §2 shape). */
export function makePanic(overrides: Partial<PanicEvent> = {}): PanicEvent {
  return {
    panic_id: 'panic-1',
    event_id: '9f1c5b0e-3d2a-4f77-9c11-0a2b3c4d5e6f',
    vehicle_id: 'VEH-001',
    timestamp_utc: '2026-11-12T11:20:00Z',
    last_known_position: {
      latitude: 41.1579,
      longitude: -8.6291,
      timestamp_utc: '2026-11-12T11:19:40Z',
    },
    source: 'MobileApp',
    acknowledged: false,
    acknowledged_at_utc: null,
    acknowledged_by: null,
    ...overrides,
  };
}

/**
 * Builds a position event fixture. The default timestamp is "now" so status
 * derivation sees a fresh position regardless of the wall clock.
 */
export function makePositionEvent(overrides: Partial<PositionEvent> = {}): PositionEvent {
  return {
    event_id: 'e102395e-6ef1-4c46-b3bf-68d46fb6b7e5',
    vehicle_id: 'VEH-001',
    latitude: 41.1496,
    longitude: -8.611,
    timestamp_utc: new Date().toISOString(),
    speed_kmh: 68.2,
    source: 'MobileApp',
    trip_id: 'trip-1',
    ...overrides,
  };
}

/** Builds a pending command fixture (contract §3 shape). */
export function makeCommand(
  deviceId: string,
  request: DispatchCommandRequest,
  overrides: Partial<Command> = {},
): Command {
  return {
    command_id: `cmd-${deviceId}`,
    device_id: deviceId,
    command_type: request.command_type,
    payload: request.payload,
    status: 'Pending',
    created_at_utc: '2026-11-12T11:21:00Z',
    acknowledged_at_utc: null,
    silenced_until_utc: null,
    error: null,
    ...overrides,
  };
}

/** Builds a registered tracker fixture (contract §4 shape). */
export function makeTracker(overrides: Partial<Tracker> = {}): Tracker {
  return {
    tracker_id: 't1t2t3t4-5555-4666-7777-888899990000',
    type: 'Sascar',
    name: 'Fleet A — plate 12-AB-34',
    vehicle_id: 'VEH-010',
    polling_interval_seconds: 30,
    credentials: { plate: '12-AB-34', integration_user: 'corelog', password: 'secret' },
    enabled: true,
    created_at_utc: '2026-11-10T09:00:00Z',
    ...overrides,
  };
}

/** Two-device fleet shared by the viewmodel tests. */
export function makeFleet(): Device[] {
  return [
    makeDevice(),
    makeDevice({
      vehicle_id: 'VEH-002',
      display_name: 'Van 02',
      status: 'PossiblyOffline',
      region: 'Lisbon',
      trip_id: null,
      last_position_at_utc: '2026-11-12T11:15:00Z',
    }),
  ];
}

/**
 * Creates an `ICoreLogClient` test double with sensible resolved values.
 * Tests can override any method with `mockResolvedValue` / `mockImplementation`.
 */
export function createApiMock() {
  return {
    getDevices: vi.fn(async (): Promise<Device[]> => makeFleet()),
    getPanics: vi.fn(async (_query?: PanicQuery): Promise<PanicEvent[]> => [makePanic()]),
    acknowledgePanic: vi.fn(
      async (panicId: string, request: { operator: string }): Promise<PanicEvent> =>
        makePanic({
          panic_id: panicId,
          acknowledged: true,
          acknowledged_at_utc: '2026-11-12T11:25:00Z',
          acknowledged_by: request.operator,
        }),
    ),
    dispatchCommand: vi.fn(
      async (deviceId: string, request: DispatchCommandRequest): Promise<Command> =>
        makeCommand(deviceId, request),
    ),
    getCommandHistory: vi.fn(
      async (_deviceId: string): Promise<Command[]> => [],
    ),
    getPositions: vi.fn(
      async (_vehicleId: string, _fromUtc: string, _toUtc: string): Promise<PositionEvent[]> => [],
    ),
    getLastPosition: vi.fn(
      async (_vehicleId: string): Promise<PositionEvent | null> => null,
    ),
    getTripPositions: vi.fn(async (_tripId: string): Promise<PositionEvent[]> => []),
    listTrackers: vi.fn(async (): Promise<Tracker[]> => []),
    registerTracker: vi.fn(
      async (request: RegisterTrackerRequest): Promise<RegisterTrackerResponse> => ({
        tracker_id: 'tracker-new',
        type: request.type,
        vehicle_id: request.vehicle_id,
      }),
    ),
    deleteTracker: vi.fn(async (_trackerId: string): Promise<void> => undefined),
  };
}

/** Type of {@link createApiMock}. */
export type ApiMock = ReturnType<typeof createApiMock>;

/** Asserts (at compile time) that the API mock satisfies the client port. */
export function asClient(mock: ApiMock): ICoreLogClient {
  return mock;
}

/** Handle used by tests to simulate SignalR events and inspect group joins. */
export interface RealtimeMock {
  /** The port injected into the viewmodel under test. */
  realtime: ITrackingRealtime;
  /** Pushes a `PositionReceived` event to all subscribers. */
  emitPosition(event: PositionEvent): void;
  /** Pushes a `PanicReceived` event to all subscribers. */
  emitPanic(payload: PanicReceivedPayload): void;
  /** Pushes a `DeviceStatusChanged` event to all subscribers. */
  emitStatusChanged(payload: DeviceStatusChangedPayload): void;
  /** Pushes a `CommandAcked` event to all subscribers. */
  emitCommandAcked(payload: CommandAckedPayload): void;
  /** Vehicle groups joined via `joinVehicle`. */
  joinedVehicles(): string[];
  /** Whether the `all-devices` group was joined. */
  isJoinedAll(): boolean;
}

/**
 * Creates an `ITrackingRealtime` test double. Subscriptions, group joins and
 * event delivery are all handled in memory.
 */
export function createRealtimeMock(initialState: ConnectionState = 'Disconnected'): RealtimeMock {
  const positionHandlers = new Set<(event: PositionEvent) => void>();
  const panicHandlers = new Set<(payload: PanicReceivedPayload) => void>();
  const statusHandlers = new Set<(payload: DeviceStatusChangedPayload) => void>();
  const ackHandlers = new Set<(payload: CommandAckedPayload) => void>();
  const stateHandlers = new Set<(state: ConnectionState) => void>();
  const vehicles: string[] = [];
  let joinedAll = false;
  let state: ConnectionState = initialState;

  const setState = (next: ConnectionState): void => {
    state = next;
    for (const handler of [...stateHandlers]) {
      handler(state);
    }
  };

  const realtime: ITrackingRealtime = {
    start: vi.fn(async () => {
      setState('Connected');
    }),
    stop: vi.fn(async () => {
      setState('Disconnected');
    }),
    joinAll: vi.fn(async () => {
      joinedAll = true;
    }),
    joinVehicle: vi.fn(async (vehicleId: string) => {
      if (!vehicles.includes(vehicleId)) {
        vehicles.push(vehicleId);
      }
    }),
    onPositionReceived: (handler) => {
      positionHandlers.add(handler);
      return () => {
        positionHandlers.delete(handler);
      };
    },
    onPanicReceived: (handler) => {
      panicHandlers.add(handler);
      return () => {
        panicHandlers.delete(handler);
      };
    },
    onDeviceStatusChanged: (handler) => {
      statusHandlers.add(handler);
      return () => {
        statusHandlers.delete(handler);
      };
    },
    onCommandAcked: (handler) => {
      ackHandlers.add(handler);
      return () => {
        ackHandlers.delete(handler);
      };
    },
    onConnectionStateChange: (handler) => {
      stateHandlers.add(handler);
      return () => {
        stateHandlers.delete(handler);
      };
    },
    getConnectionState: () => state,
  };

  return {
    realtime,
    emitPosition: (event) => {
      for (const handler of [...positionHandlers]) {
        handler(event);
      }
    },
    emitPanic: (payload) => {
      for (const handler of [...panicHandlers]) {
        handler(payload);
      }
    },
    emitStatusChanged: (payload) => {
      for (const handler of [...statusHandlers]) {
        handler(payload);
      }
    },
    emitCommandAcked: (payload) => {
      for (const handler of [...ackHandlers]) {
        handler(payload);
      }
    },
    joinedVehicles: () => [...vehicles],
    isJoinedAll: () => joinedAll,
  };
}
