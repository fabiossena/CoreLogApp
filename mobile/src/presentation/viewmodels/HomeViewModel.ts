/**
 * HomeViewModel (presentation layer — MVVM ViewModel).
 *
 * Exposes an **observable view state** (`getSnapshot`/`subscribe`, compatible
 * with React's `useSyncExternalStore`) plus three commands:
 * `startTracking`, `stopTracking` and `sendPanic`.
 *
 * The ViewModel orchestrates the domain use cases only — it contains no HTTP,
 * no SQLite and no native calls (Sole Responsibility: presentation state).
 * The background-service state flows in through the {@link TrackingStateSource}
 * port, which the composition root binds to `BackgroundServiceBridge`.
 */
import {StartTrackingUseCase} from '../../domain/usecases/StartTrackingUseCase';
import {StopTrackingUseCase} from '../../domain/usecases/StopTrackingUseCase';
import {PanicSendResult, SendPanicUseCase} from '../../domain/usecases/SendPanicUseCase';

/** Observable state of the background service that the view renders. */
export interface TrackingStateSnapshot {
  /** Whether native tracking is running. */
  trackingEnabled: boolean;
  /** ISO-8601 UTC of the last successful batch send, or `null`. */
  lastSendAtUtc: string | null;
  /** Positions waiting in the native offline queue. */
  pendingCount: number;
  /** Current native sampling period in seconds. */
  intervalSeconds?: number;
  /** ISO-8601 UTC until which sending is silenced, or `null`. */
  silencedUntilUtc?: string | null;
}

/** Port to the observable background-service state (bound to the bridge). */
export interface TrackingStateSource {
  /** @returns the current snapshot (stable between changes). */
  getState(): TrackingStateSnapshot;
  /**
   * @param listener - invoked on every state change.
   * @returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void;
}

/** JS-side SQLite buffer operations used by the view model. */
export interface LocalBufferPort {
  /** @returns rows waiting in the JS offline buffer. */
  getPendingCount(): Promise<number>;
  /** Drains buffered rows; @returns how many were sent. */
  flush(): Promise<number>;
}

/** Everything the view renders. */
export interface HomeViewState {
  /** Tracking ON/OFF. */
  trackingEnabled: boolean;
  /** Last successful send (ISO-8601 UTC) or `null` ("never"). */
  lastSendAtUtc: string | null;
  /** Positions waiting in the native offline queue. */
  bufferCount: number;
  /** Positions waiting in the JS offline buffer. */
  localBufferCount: number;
  /** Current sampling period in seconds. */
  intervalSeconds: number;
  /** ISO-8601 UTC until which sending is silenced, or `null`. */
  silencedUntilUtc: string | null;
  /** `true` while a command is running (disables buttons). */
  isBusy: boolean;
  /** Last error message, or `null`. */
  lastError: string | null;
  /** When the last panic was raised (ISO-8601 UTC), or `null`. */
  lastPanicAtUtc: string | null;
  /** `true` when the last panic had to be queued (offline). */
  lastPanicQueued: boolean;
}

/** Dependencies of {@link HomeViewModel} (all injected — DIP). */
export interface HomeViewModelDeps {
  /** Start-tracking use case. */
  startTracking: StartTrackingUseCase;
  /** Stop-tracking use case. */
  stopTracking: StopTrackingUseCase;
  /** Panic use case. */
  sendPanic: SendPanicUseCase;
  /** Observable background-service state (the bridge). */
  stateSource: TrackingStateSource;
  /** JS-side offline buffer (the location repository). */
  localBuffer: LocalBufferPort;
  /** Vehicle bound to this installation (`vehicle_id` of panics). */
  vehicleId: string;
}

const INITIAL_STATE: HomeViewState = {
  trackingEnabled: false,
  lastSendAtUtc: null,
  bufferCount: 0,
  localBufferCount: 0,
  intervalSeconds: 60,
  silencedUntilUtc: null,
  isBusy: false,
  lastError: null,
  lastPanicAtUtc: null,
  lastPanicQueued: false,
};

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 200);
  }
  return 'Unexpected error';
}

/**
 * MVVM ViewModel backing `HomeScreen`.
 *
 * @remarks
 * Snapshot identity is stable: listeners are notified only when a value
 * actually changes, which makes `useSyncExternalStore` safe.
 */
export class HomeViewModel {
  private readonly startTrackingUseCase: StartTrackingUseCase;
  private readonly stopTrackingUseCase: StopTrackingUseCase;
  private readonly sendPanicUseCase: SendPanicUseCase;
  private readonly stateSource: TrackingStateSource;
  private readonly localBuffer: LocalBufferPort;
  private readonly vehicleId: string;

  private readonly listeners = new Set<() => void>();
  private unsubscribeState: (() => void) | null = null;
  private initialized = false;
  private snapshot: HomeViewState = {...INITIAL_STATE};

  /**
   * @param dependencies - use cases and observable ports.
   */
  constructor(dependencies: HomeViewModelDeps) {
    this.startTrackingUseCase = dependencies.startTracking;
    this.stopTrackingUseCase = dependencies.stopTracking;
    this.sendPanicUseCase = dependencies.sendPanic;
    this.stateSource = dependencies.stateSource;
    this.localBuffer = dependencies.localBuffer;
    this.vehicleId = dependencies.vehicleId;

    // Bound so they can be passed directly to `useSyncExternalStore`.
    this.getSnapshot = this.getSnapshot.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }

  // -- observable API -------------------------------------------------------

  /**
   * @returns the current, cached view state (stable reference).
   */
  getSnapshot(): HomeViewState {
    return this.snapshot;
  }

  /**
   * Subscribes the view to state changes.
   *
   * @param listener - re-render trigger.
   * @returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // -- lifecycle ------------------------------------------------------------

  /**
   * Subscribes to the background-service state, drains the JS offline buffer
   * (best effort) and performs the first state sync. Idempotent.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.unsubscribeState = this.stateSource.subscribe(() => {
      this.syncFromSource();
    });
    this.syncFromSource();
    try {
      const flushed = await this.localBuffer.flush();
      if (flushed > 0) {
        this.patch({lastError: null});
      }
    } catch (error) {
      this.patch({lastError: describeError(error)});
    }
    await this.refresh();
  }

  /** Unsubscribes from all sources (called on unmount). */
  dispose(): void {
    this.unsubscribeState?.();
    this.unsubscribeState = null;
    this.listeners.clear();
    this.initialized = false;
  }

  /**
   * Re-reads both buffers and the service state.
   */
  async refresh(): Promise<void> {
    this.syncFromSource();
    try {
      const localBufferCount = await this.localBuffer.getPendingCount();
      this.patch({localBufferCount});
    } catch {
      // Buffer unavailable (e.g. native module missing) — keep last value.
    }
  }

  // -- commands -------------------------------------------------------------

  /**
   * Command: start background tracking.
   */
  async startTracking(): Promise<void> {
    if (this.snapshot.isBusy) {
      return;
    }
    this.patch({isBusy: true, lastError: null});
    try {
      await this.startTrackingUseCase.execute();
    } catch (error) {
      this.patch({lastError: describeError(error)});
    } finally {
      this.patch({isBusy: false});
      await this.refresh();
    }
  }

  /**
   * Command: stop background tracking (buffered data is preserved).
   */
  async stopTracking(): Promise<void> {
    if (this.snapshot.isBusy) {
      return;
    }
    this.patch({isBusy: true, lastError: null});
    try {
      await this.stopTrackingUseCase.execute();
    } catch (error) {
      this.patch({lastError: describeError(error)});
    } finally {
      this.patch({isBusy: false});
      await this.refresh();
    }
  }

  /**
   * Command: raise a panic (works even when tracking is OFF).
   *
   * @returns the panic result, or `null` when the command was ignored
   *          because another command is already running.
   */
  async sendPanic(): Promise<PanicSendResult | null> {
    if (this.snapshot.isBusy) {
      return null;
    }
    this.patch({isBusy: true, lastError: null});
    try {
      const result = await this.sendPanicUseCase.execute(this.vehicleId);
      this.patch({
        lastPanicAtUtc: result.timestampUtc,
        lastPanicQueued: result.queued,
        lastError: result.queued ? 'Offline: panic saved for delivery' : null,
      });
      return result;
    } catch (error) {
      this.patch({lastError: describeError(error)});
      return null;
    } finally {
      this.patch({isBusy: false});
      await this.refresh();
    }
  }

  private syncFromSource(): void {
    const state = this.stateSource.getState();
    this.patch({
      trackingEnabled: state.trackingEnabled,
      lastSendAtUtc: state.lastSendAtUtc,
      bufferCount: state.pendingCount,
      intervalSeconds: state.intervalSeconds ?? this.snapshot.intervalSeconds,
      silencedUntilUtc:
        state.silencedUntilUtc !== undefined
          ? state.silencedUntilUtc
          : this.snapshot.silencedUntilUtc,
    });
  }

  private patch(partial: Partial<HomeViewState>): void {
    const next: HomeViewState = {...this.snapshot, ...partial};
    const changed = (Object.keys(partial) as Array<keyof HomeViewState>).some(
      key => this.snapshot[key] !== next[key],
    );
    if (!changed) {
      return;
    }
    this.snapshot = next;
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}
