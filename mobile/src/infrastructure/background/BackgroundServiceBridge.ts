/**
 * Background-service bridge (infrastructure layer).
 *
 * JavaScript façade over the native `CoreLogBackgroundService` module:
 *
 * - Android: foreground service with a persistent notification + WorkManager
 *   watchdog (see `android/.../background/`).
 * - iOS: CoreLocation running with the `location` background mode
 *   (see `ios/CoreLogMobile/CoreLogLocationManager.swift`).
 *
 * The bridge is an **observable state holder**: the native module emits
 * `CoreLogBackgroundService.state` events (tracking on/off, last successful
 * send, pending rows, silence window), the bridge caches them and notifies
 * subscribers — which is what `HomeViewModel` renders.
 *
 * It implements the domain ports `TrackingActivator`, `TrackingTerminator`,
 * `RemoteCommandTarget`, `LastKnownPositionSource` and `PanicQueue`
 * (dependency inversion: domain and presentation never import this module;
 * the composition root injects it).
 */
import {NativeModules, NativeEventEmitter} from 'react-native';
import {AppEnv} from '../../config/env';
import {Position} from '../../domain/entities/Position';
import {PanicEvent} from '../../domain/entities/PanicEvent';
import {RemoteCommand} from '../../domain/entities/RemoteCommand';
import {TrackingActivator} from '../../domain/usecases/StartTrackingUseCase';
import {TrackingTerminator} from '../../domain/usecases/StopTrackingUseCase';
import {LastKnownPositionSource, PanicQueue} from '../../domain/usecases/SendPanicUseCase';
import {RemoteCommandTarget} from '../../domain/usecases/HandleRemoteCommandUseCase';
import {toPanicRequestDto, PanicRequestDto} from '../http/CoreLogApiClient';

/** Native state as reported by the platform modules. */
export interface NativeTrackingState {
  /** Whether native collection is running. */
  trackingEnabled: boolean;
  /** ISO-8601 UTC of the last successful batch upload, or `null`. */
  lastSendAtUtc: string | null;
  /** Rows currently waiting in the native SQLite queue. */
  pendingCount: number;
  /** ISO-8601 UTC until which sending is silenced, or `null`. */
  silencedUntilUtc: string | null;
  /** Current sampling period in seconds. */
  intervalSeconds: number;
}

/** Position shape returned by the native module (snake_case on the bridge). */
export interface NativePositionDto {
  latitude: number;
  longitude: number;
  timestamp_utc: string;
  speed_kmh?: number;
}

/** Configuration accepted by the native `start` method. */
export interface NativeStartConfig {
  positionIntervalSeconds: number;
  batchSize: number;
  coreLogBaseUrl: string;
  vehicleId: string;
}

/** The native module surface used by this bridge. */
export interface NativeBackgroundService {
  start(config: NativeStartConfig): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<NativeTrackingState>;
  setPositionInterval(seconds: number): Promise<void>;
  silence(durationSeconds: number): Promise<void>;
  reactivate(): Promise<void>;
  requestImmediatePosition(): Promise<void>;
  enqueuePanic(payload: PanicRequestDto): Promise<void>;
  getLastKnownPosition(): Promise<NativePositionDto | null>;
  /** Required by `NativeEventEmitter`. */
  addListener(eventName: string): void;
  /** Required by `NativeEventEmitter`. */
  removeListeners(count: number): void;
}

/** Minimal event-emitter surface used by the bridge. */
export interface BridgeEventEmitter {
  addListener(eventName: string, listener: (state: NativeTrackingState) => void): {
    remove(): void;
  };
}

/** Synchronous snapshot of the background-service state (observable model). */
export interface TrackingStateSnapshot extends NativeTrackingState {}

/** Constructor overrides — tests inject fakes, the app uses the defaults. */
export interface BackgroundServiceBridgeDependencies {
  /** Native module (defaults to `NativeModules.CoreLogBackgroundService`). */
  nativeModule?: NativeBackgroundService;
  /** Event source (defaults to `new NativeEventEmitter(nativeModule)`). */
  eventEmitter?: BridgeEventEmitter;
  /**
   * Permission helper from `@bglocation/react-native`.
   * Pass `null` to disable it (tests); omit for the lazy default.
   */
  bgLocation?: BgLocationModulePort | null;
  /** Resolved application configuration. */
  env: AppEnv;
}

/** Permission result loosely interpreted from `@bglocation/react-native`. */
export interface BgLocationPermissionResult {
  /** `false` means the OS denied the permission. */
  granted?: boolean;
  /** Alternative denial flag used by some versions. */
  status?: string;
  /** Per-permission detail (`granted`/`denied`/`blocked`). */
  location?: string;
}

/** Subset of `@bglocation/react-native` used by this bridge. */
export interface BgLocationModulePort {
  /**
   * Requests location permissions.
   *
   * @param options - e.g. `{permissions: ['location']}`.
   * @returns an loosely-typed permission result.
   */
  requestPermissions(options: {permissions: string[]}): Promise<unknown>;
}

/** Event name emitted by both platform modules on every state change. */
export const BACKGROUND_SERVICE_STATE_EVENT = 'CoreLogBackgroundService.state';

const INITIAL_STATE: TrackingStateSnapshot = {
  trackingEnabled: false,
  lastSendAtUtc: null,
  pendingCount: 0,
  silencedUntilUtc: null,
  intervalSeconds: 60,
};

function resolveNativeModule(): NativeBackgroundService | undefined {
  return (NativeModules as Record<string, unknown>).CoreLogBackgroundService as
    | NativeBackgroundService
    | undefined;
}

function resolveEmitter(nativeModule: NativeBackgroundService): BridgeEventEmitter | undefined {
  try {
    return new NativeEventEmitter(nativeModule as never) as unknown as BridgeEventEmitter;
  } catch {
    return undefined;
  }
}

function loadBgLocationModule(): BgLocationModulePort | undefined {
  try {
    // Lazy require: TurboModule from `@bglocation/react-native`, only loaded
    // inside the running app (Jest maps the package to a stub).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bgLocationModule = require('@bglocation/react-native') as {
      default?: BgLocationModulePort;
    } & BgLocationModulePort;
    return bgLocationModule.default ?? bgLocationModule;
  } catch {
    return undefined;
  }
}

function isExplicitlyDenied(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) {
    return false;
  }
  const permission = result as BgLocationPermissionResult;
  return (
    permission.granted === false ||
    permission.status === 'denied' ||
    permission.status === 'blocked' ||
    permission.location === 'denied' ||
    permission.location === 'blocked'
  );
}

/**
 * Observable, injectable bridge to the native background service.
 *
 * Implements the domain ports used by the use cases and exposes a
 * `subscribe`/`getState` pair consumed by `HomeViewModel`.
 */
export class BackgroundServiceBridge
  implements
    TrackingActivator,
    TrackingTerminator,
    RemoteCommandTarget,
    LastKnownPositionSource,
    PanicQueue
{
  private readonly nativeModule: NativeBackgroundService | undefined;
  private readonly env: AppEnv;
  /** `undefined` = lazy default, `null` = disabled, object = injected. */
  private readonly bgLocationOverride: BgLocationModulePort | null | undefined;
  private bgLocationResolved = false;
  private bgLocationModule: BgLocationModulePort | undefined;
  private state: TrackingStateSnapshot;
  /** Bumped on every applied change; invalidates in-flight refreshes. */
  private stateVersion = 0;
  private readonly listeners = new Set<() => void>();
  private subscription: {remove(): void} | null = null;

  /**
   * @param dependencies - injectable native module/emitter plus config.
   */
  constructor(dependencies: BackgroundServiceBridgeDependencies) {
    this.env = dependencies.env;
    this.nativeModule = dependencies.nativeModule ?? resolveNativeModule();
    this.bgLocationOverride =
      'bgLocation' in dependencies ? dependencies.bgLocation ?? null : undefined;
    this.state = {...INITIAL_STATE, intervalSeconds: dependencies.env.positionIntervalSeconds};

    const emitter =
      dependencies.eventEmitter ??
      (this.nativeModule ? resolveEmitter(this.nativeModule) : undefined);
    if (emitter && this.nativeModule) {
      this.subscription = emitter.addListener(BACKGROUND_SERVICE_STATE_EVENT, nativeState => {
        this.applyState(nativeState);
      });
    }
  }

  // -- observable state -----------------------------------------------------

  /**
   * @returns the current cached snapshot (stable reference until a change).
   */
  getState(): TrackingStateSnapshot {
    return this.state;
  }

  /**
   * Subscribes to state changes (compatible with `useSyncExternalStore`).
   *
   * @param listener - invoked after every state mutation.
   * @returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    void this.refreshState();
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Pulls the authoritative state from the native module (best effort).
   *
   * A concurrent event emission invalidates in-flight refreshes so a stale
   * `getState()` response can never overwrite a fresher pushed state.
   */
  async refreshState(): Promise<void> {
    const nativeModule = this.requireNativeModule();
    if (!nativeModule) {
      return;
    }
    const versionAtStart = this.stateVersion;
    try {
      const fresh = await nativeModule.getState();
      if (versionAtStart !== this.stateVersion) {
        return; // a pushed state arrived while we were waiting
      }
      this.applyState(fresh);
    } catch {
      // Native side unavailable (e.g. simulator without the module yet).
    }
  }

  // -- TrackingActivator / TrackingTerminator --------------------------------

  /**
   * Starts native background collection.
   *
   * @param intervalSeconds - seconds between two native samples.
   */
  async startTracking(intervalSeconds: number): Promise<void> {
    await this.ensureLocationPermissions();
    const nativeModule = this.requireNativeModule();
    if (!nativeModule) {
      return;
    }
    await nativeModule.start({
      positionIntervalSeconds: intervalSeconds,
      batchSize: this.env.batchSize,
      coreLogBaseUrl: this.env.coreLogBaseUrl,
      vehicleId: this.env.vehicleId,
    });
    await this.refreshState();
  }

  /** Stops native background collection and dismisses the notification. */
  async stopTracking(): Promise<void> {
    const nativeModule = this.requireNativeModule();
    if (!nativeModule) {
      return;
    }
    await nativeModule.stop();
    await this.refreshState();
  }

  // -- RemoteCommandTarget ---------------------------------------------------

  /**
   * Applies a parsed remote command to the native service.
   *
   * @param command - `SET_FREQUENCY` | `SILENCE` | `REACTIVATE` |
   *                  `REQUEST_IMMEDIATE_POSITION`.
   * @throws when the command is unknown or the native side rejects it.
   */
  async applyRemoteCommand(command: RemoteCommand): Promise<void> {
    const nativeModule = this.requireNativeModule(true);
    switch (command.commandType) {
      case 'SET_FREQUENCY': {
        if (command.seconds === undefined) {
          throw new Error('SET_FREQUENCY requires "seconds"');
        }
        await nativeModule.setPositionInterval(command.seconds);
        break;
      }
      case 'SILENCE': {
        if (command.durationSeconds === undefined) {
          throw new Error('SILENCE requires "duration_seconds"');
        }
        await nativeModule.silence(command.durationSeconds);
        break;
      }
      case 'REACTIVATE': {
        await nativeModule.reactivate();
        break;
      }
      case 'REQUEST_IMMEDIATE_POSITION': {
        await nativeModule.requestImmediatePosition();
        break;
      }
      default: {
        const exhaustive: never = command.commandType;
        throw new Error(`Unknown command type: ${String(exhaustive)}`);
      }
    }
    await this.refreshState();
  }

  // -- LastKnownPositionSource ----------------------------------------------

  /**
   * @returns the last native position mapped to the domain entity,
   *          or `null` when none was recorded yet.
   */
  async getLastKnownPosition(): Promise<Position | null> {
    const nativeModule = this.requireNativeModule();
    if (!nativeModule) {
      return null;
    }
    const dto = await nativeModule.getLastKnownPosition();
    if (!dto) {
      return null;
    }
    const position: Position = {
      vehicleId: this.env.vehicleId,
      latitude: dto.latitude,
      longitude: dto.longitude,
      timestampUtc: dto.timestamp_utc,
    };
    if (dto.speed_kmh !== undefined) {
      position.speedKmh = dto.speed_kmh;
    }
    return position;
  }

  // -- PanicQueue ------------------------------------------------------------

  /**
   * Hands a panic to the native high-priority SQLite queue; the background
   * service (or its WorkManager drain job) uploads it when connectivity
   * returns, even if tracking is off and the app is closed.
   *
   * @param event - panic to enqueue.
   */
  async enqueuePanic(event: PanicEvent): Promise<void> {
    const nativeModule = this.requireNativeModule(true);
    await nativeModule.enqueuePanic(toPanicRequestDto(event));
  }

  /** Schedules an immediate best-effort drain of the native queues. */
  async scheduleDrain(): Promise<void> {
    const nativeModule = this.requireNativeModule();
    if (!nativeModule) {
      return;
    }
    // Implemented natively as part of `enqueuePanic` / WorkManager; the
    // explicit hook exists for callers that flush after connectivity restore.
    await this.refreshState();
  }

  /** Whether native collection is currently running (synchronous view). */
  isTrackingEnabled(): boolean {
    return this.state.trackingEnabled;
  }

  /** Detaches the native event subscription. */
  dispose(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.listeners.clear();
  }

  /**
   * Ensures foreground (and best-effort background) location permissions via
   * `@bglocation/react-native` before starting the native service.
   *
   * @throws when the OS explicitly denied location permission.
   */
  private async ensureLocationPermissions(): Promise<void> {
    const bgLocation = this.resolveBgLocation();
    if (!bgLocation || typeof bgLocation.requestPermissions !== 'function') {
      // Library unavailable — the native service enforces permissions itself.
      return;
    }
    const foreground = await bgLocation.requestPermissions({permissions: ['location']});
    if (isExplicitlyDenied(foreground)) {
      throw new Error('Location permission denied — cannot start tracking');
    }
    try {
      await bgLocation.requestPermissions({permissions: ['backgroundLocation']});
    } catch {
      // Android may defer the "Allow all the time" grant; the foreground
      // service re-requests it when the OS requires it.
    }
  }

  private resolveBgLocation(): BgLocationModulePort | undefined {
    if (this.bgLocationOverride !== undefined) {
      return this.bgLocationOverride ?? undefined;
    }
    if (!this.bgLocationResolved) {
      this.bgLocationResolved = true;
      this.bgLocationModule = loadBgLocationModule();
    }
    return this.bgLocationModule;
  }

  private requireNativeModule(throwWhenMissing: true): NativeBackgroundService;
  private requireNativeModule(throwWhenMissing?: false): NativeBackgroundService | undefined;
  private requireNativeModule(throwWhenMissing = false): NativeBackgroundService | undefined {
    if (!this.nativeModule) {
      if (throwWhenMissing) {
        throw new Error(
          'CoreLogBackgroundService native module is not available in this runtime',
        );
      }
      return undefined;
    }
    return this.nativeModule;
  }

  private applyState(nativeState: Partial<NativeTrackingState> | null | undefined): void {
    if (!nativeState) {
      return;
    }
    const next: TrackingStateSnapshot = {
      trackingEnabled: nativeState.trackingEnabled ?? this.state.trackingEnabled,
      lastSendAtUtc:
        nativeState.lastSendAtUtc !== undefined
          ? nativeState.lastSendAtUtc
          : this.state.lastSendAtUtc,
      pendingCount: nativeState.pendingCount ?? this.state.pendingCount,
      silencedUntilUtc:
        nativeState.silencedUntilUtc !== undefined
          ? nativeState.silencedUntilUtc
          : this.state.silencedUntilUtc,
      intervalSeconds: nativeState.intervalSeconds ?? this.state.intervalSeconds,
    };
    if (
      next.trackingEnabled === this.state.trackingEnabled &&
      next.lastSendAtUtc === this.state.lastSendAtUtc &&
      next.pendingCount === this.state.pendingCount &&
      next.silencedUntilUtc === this.state.silencedUntilUtc &&
      next.intervalSeconds === this.state.intervalSeconds
    ) {
      return;
    }
    this.state = next;
    this.stateVersion += 1;
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}
