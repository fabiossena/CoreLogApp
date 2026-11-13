/**
 * Realtime layer: typed SignalR client for the CoreLog `TrackingHub`
 * (`/hubs/tracking`).
 *
 * Groups (docs/api-contract.md, §6):
 * - `all-devices` — dashboard stream (positions, panics, status changes).
 * - `device-{vehicleId}` — device detail page.
 *
 * The client registers the four server events once and fans them out to
 * typed subscriber sets; every `onXxx` call returns an unsubscribe function
 * so viewmodels can clean up on unmount. The dashboard never opens a
 * WebSocket to devices — CoreLog is the only realtime source.
 */

import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import type {
  DeviceStatusChangedPayload,
  PositionEvent,
} from '../domain/entities/Device';
import type { PanicReceivedPayload } from '../domain/entities/PanicEvent';
import type { CommandAckedPayload } from '../domain/entities/Command';

/** Connection lifecycle states surfaced to the UI. */
export type ConnectionState =
  | 'Disconnected'
  | 'Connecting'
  | 'Connected'
  | 'Reconnecting'
  | 'Disconnecting';

/** Removes an event subscription. */
export type Unsubscribe = () => void;

/** Port used by viewmodels that consume realtime events (Dependency Inversion). */
export interface ITrackingRealtime {
  /** Starts the hub connection (idempotent). */
  start(): Promise<void>;
  /** Stops the hub connection. */
  stop(): Promise<void>;
  /** Joins the `all-devices` group (dashboard stream). */
  joinAll(): Promise<void>;
  /** Joins the `device-{vehicleId}` group (device detail stream). */
  joinVehicle(vehicleId: string): Promise<void>;
  /** Subscribes to `PositionReceived`; returns an unsubscribe function. */
  onPositionReceived(handler: (event: PositionEvent) => void): Unsubscribe;
  /** Subscribes to `PanicReceived`; returns an unsubscribe function. */
  onPanicReceived(handler: (payload: PanicReceivedPayload) => void): Unsubscribe;
  /** Subscribes to `DeviceStatusChanged`; returns an unsubscribe function. */
  onDeviceStatusChanged(handler: (payload: DeviceStatusChangedPayload) => void): Unsubscribe;
  /** Subscribes to `CommandAcked`; returns an unsubscribe function. */
  onCommandAcked(handler: (payload: CommandAckedPayload) => void): Unsubscribe;
  /** Subscribes to connection state transitions; returns an unsubscribe function. */
  onConnectionStateChange(handler: (state: ConnectionState) => void): Unsubscribe;
  /** Current connection state. */
  getConnectionState(): ConnectionState;
}

function mapConnectionState(state: HubConnectionState): ConnectionState {
  switch (state) {
    case HubConnectionState.Connected:
      return 'Connected';
    case HubConnectionState.Connecting:
      return 'Connecting';
    case HubConnectionState.Reconnecting:
      return 'Reconnecting';
    case HubConnectionState.Disconnecting:
      return 'Disconnecting';
    default:
      return 'Disconnected';
  }
}

/** Construction options of {@link SignalRClient}. */
export interface SignalRClientOptions {
  /** Log level passed to the SignalR hub connection. */
  logLevel?: LogLevel;
}

/**
 * SignalR client bound to the CoreLog TrackingHub.
 *
 * @example
 * ```ts
 * const realtime = new SignalRClient('http://localhost:8090/hubs/tracking');
 * await realtime.start();
 * await realtime.joinAll();
 * const unsubscribe = realtime.onPositionReceived((event) => console.log(event.vehicle_id));
 * ```
 */
export class SignalRClient implements ITrackingRealtime {
  private readonly connection: HubConnection;
  private readonly positionHandlers = new Set<(event: PositionEvent) => void>();
  private readonly panicHandlers = new Set<(payload: PanicReceivedPayload) => void>();
  private readonly statusHandlers = new Set<(payload: DeviceStatusChangedPayload) => void>();
  private readonly ackHandlers = new Set<(payload: CommandAckedPayload) => void>();
  private readonly stateHandlers = new Set<(state: ConnectionState) => void>();

  constructor(hubUrl: string, options: SignalRClientOptions = {}) {
    this.connection = new HubConnectionBuilder()
      .withUrl(hubUrl)
      .configureLogging(options.logLevel ?? LogLevel.Warning)
      .withAutomaticReconnect()
      .build();

    this.connection.on('PositionReceived', (event: PositionEvent) => {
      this.emit(this.positionHandlers, event);
    });
    this.connection.on('PanicReceived', (payload: PanicReceivedPayload) => {
      this.emit(this.panicHandlers, payload);
    });
    this.connection.on('DeviceStatusChanged', (payload: DeviceStatusChangedPayload) => {
      this.emit(this.statusHandlers, payload);
    });
    this.connection.on('CommandAcked', (payload: CommandAckedPayload) => {
      this.emit(this.ackHandlers, payload);
    });

    this.connection.onreconnecting(() => this.publishState());
    this.connection.onreconnected(() => this.publishState());
    this.connection.onclose(() => this.publishState());
  }

  /** Fans an event payload out to all subscribers, isolating handler errors. */
  private emit<T>(handlers: Set<(payload: T) => void>, payload: T): void {
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch (error) {
        // A broken subscriber must not stop delivery to the others.
        console.error('[SignalRClient] event handler failed', error);
      }
    }
  }

  /** Notifies all connection-state subscribers of the current state. */
  private publishState(): void {
    const state = this.getConnectionState();
    for (const handler of [...this.stateHandlers]) {
      handler(state);
    }
  }

  /** {@inheritDoc ITrackingRealtime.start} */
  async start(): Promise<void> {
    if (this.connection.state === HubConnectionState.Connected) {
      return;
    }
    try {
      await this.connection.start();
    } finally {
      this.publishState();
    }
  }

  /** {@inheritDoc ITrackingRealtime.stop} */
  async stop(): Promise<void> {
    if (this.connection.state === HubConnectionState.Disconnected) {
      return;
    }
    try {
      await this.connection.stop();
    } finally {
      this.publishState();
    }
  }

  /** {@inheritDoc ITrackingRealtime.joinAll} */
  async joinAll(): Promise<void> {
    await this.connection.invoke('JoinAll');
  }

  /** {@inheritDoc ITrackingRealtime.joinVehicle} */
  async joinVehicle(vehicleId: string): Promise<void> {
    await this.connection.invoke('JoinVehicle', vehicleId);
  }

  /** {@inheritDoc ITrackingRealtime.onPositionReceived} */
  onPositionReceived(handler: (event: PositionEvent) => void): Unsubscribe {
    this.positionHandlers.add(handler);
    return () => {
      this.positionHandlers.delete(handler);
    };
  }

  /** {@inheritDoc ITrackingRealtime.onPanicReceived} */
  onPanicReceived(handler: (payload: PanicReceivedPayload) => void): Unsubscribe {
    this.panicHandlers.add(handler);
    return () => {
      this.panicHandlers.delete(handler);
    };
  }

  /** {@inheritDoc ITrackingRealtime.onDeviceStatusChanged} */
  onDeviceStatusChanged(handler: (payload: DeviceStatusChangedPayload) => void): Unsubscribe {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  /** {@inheritDoc ITrackingRealtime.onCommandAcked} */
  onCommandAcked(handler: (payload: CommandAckedPayload) => void): Unsubscribe {
    this.ackHandlers.add(handler);
    return () => {
      this.ackHandlers.delete(handler);
    };
  }

  /** {@inheritDoc ITrackingRealtime.onConnectionStateChange} */
  onConnectionStateChange(handler: (state: ConnectionState) => void): Unsubscribe {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  /** {@inheritDoc ITrackingRealtime.getConnectionState} */
  getConnectionState(): ConnectionState {
    return mapConnectionState(this.connection.state);
  }
}
