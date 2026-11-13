/**
 * Unit tests for `HomeViewModel` (mocked bridges/repositories via ports).
 */
import {
  HomeViewModel,
  LocalBufferPort,
  TrackingStateSnapshot,
  TrackingStateSource,
} from '../src/presentation/viewmodels/HomeViewModel';
import {StartTrackingUseCase} from '../src/domain/usecases/StartTrackingUseCase';
import {StopTrackingUseCase} from '../src/domain/usecases/StopTrackingUseCase';
import {SendPanicUseCase} from '../src/domain/usecases/SendPanicUseCase';
import {PanicEvent} from '../src/domain/entities/PanicEvent';

class FakeStateSource implements TrackingStateSource {
  state: TrackingStateSnapshot = {
    trackingEnabled: false,
    lastSendAtUtc: null,
    pendingCount: 0,
    intervalSeconds: 60,
    silencedUntilUtc: null,
  };
  private readonly listeners = new Set<() => void>();

  getState(): TrackingStateSnapshot {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(patch: Partial<TrackingStateSnapshot>): void {
    this.state = {...this.state, ...patch};
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}

class FakeLocalBuffer implements LocalBufferPort {
  rows = 2;
  flushed = 0;

  async getPendingCount(): Promise<number> {
    return this.rows;
  }

  async flush(): Promise<number> {
    const sent = this.rows;
    this.rows = 0;
    this.flushed += sent;
    return sent;
  }
}

interface HarnessOptions {
  /** Number of initial transport failures (panics fall back to the queue). */
  transportFailures?: number;
  /** When set, the panic transport waits for this promise (busy-guard test). */
  transportGate?: Promise<void>;
  /** When true, the tracking activator throws. */
  failStart?: boolean;
}

interface Harness {
  viewModel: HomeViewModel;
  source: FakeStateSource;
  buffer: FakeLocalBuffer;
  startIntervals: number[];
  stopCount: number;
  sentPanics: PanicEvent[];
  queuedPanics: PanicEvent[];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const source = new FakeStateSource();
  const buffer = new FakeLocalBuffer();
  const startIntervals: number[] = [];
  const counters = {stopCount: 0, failures: options.transportFailures ?? 0};
  const sentPanics: PanicEvent[] = [];
  const queuedPanics: PanicEvent[] = [];
  const gate = options.transportGate ?? null;

  const startTracking = new StartTrackingUseCase(
    {
      startTracking: async interval => {
        if (options.failStart) {
          throw new Error('permission denied');
        }
        startIntervals.push(interval);
        // Simulate the native `CoreLogBackgroundService.state` event.
        source.emit({trackingEnabled: true, intervalSeconds: interval});
      },
    },
    60,
  );

  const stopTracking = new StopTrackingUseCase({
    stopTracking: async () => {
      counters.stopCount += 1;
      source.emit({trackingEnabled: false});
    },
  });

  const sendPanic = new SendPanicUseCase({
    transport: {
      sendPanic: async event => {
        if (gate) {
          await gate;
        }
        if (counters.failures > 0) {
          counters.failures -= 1;
          throw new Error('network down');
        }
        sentPanics.push(event);
      },
    },
    queue: {
      enqueuePanic: async event => {
        queuedPanics.push(event);
      },
    },
    positionSource: {
      getLastKnownPosition: async () => null,
    },
    generateEventId: () => `event-${sentPanics.length + queuedPanics.length + 1}`,
    clock: () => new Date('2026-11-12T11:20:00.000Z'),
    delay: async () => undefined,
  });

  const viewModel = new HomeViewModel({
    startTracking,
    stopTracking,
    sendPanic,
    stateSource: source,
    localBuffer: buffer,
    vehicleId: 'VEH-001',
  });

  return {
    viewModel,
    source,
    buffer,
    startIntervals,
    get stopCount() {
      return counters.stopCount;
    },
    sentPanics,
    queuedPanics,
  };
}

describe('HomeViewModel', () => {
  test('exposes a stable initial snapshot', () => {
    const harness = createHarness();
    const snapshot = harness.viewModel.getSnapshot();

    expect(snapshot).toEqual({
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
    });
    expect(harness.viewModel.getSnapshot()).toBe(snapshot);
  });

  test('initialize subscribes to the bridge state, drains the JS buffer and syncs counts', async () => {
    const harness = createHarness();
    harness.source.emit({
      trackingEnabled: true,
      lastSendAtUtc: '2026-11-12T11:20:00Z',
      pendingCount: 4,
    });

    await harness.viewModel.initialize();

    const state = harness.viewModel.getSnapshot();
    expect(state.trackingEnabled).toBe(true);
    expect(state.lastSendAtUtc).toBe('2026-11-12T11:20:00Z');
    expect(state.bufferCount).toBe(4);
    expect(state.localBufferCount).toBe(0); // 2 buffered rows were flushed
    expect(harness.buffer.flushed).toBe(2);
  });

  test('notifies subscribers only when the snapshot actually changes', async () => {
    const harness = createHarness();
    await harness.viewModel.initialize();

    let notifications = 0;
    const unsubscribe = harness.viewModel.subscribe(() => {
      notifications += 1;
    });

    harness.source.emit({trackingEnabled: true});
    harness.source.emit({trackingEnabled: true}); // no-op: identical values
    expect(notifications).toBe(1);

    const before = harness.viewModel.getSnapshot();
    expect(harness.viewModel.getSnapshot()).toBe(before);

    unsubscribe();
    harness.source.emit({trackingEnabled: false});
    expect(notifications).toBe(1);
  });

  test('startTracking runs the use case and reflects native state', async () => {
    const harness = createHarness();

    await harness.viewModel.startTracking();

    expect(harness.startIntervals).toEqual([60]);
    const state = harness.viewModel.getSnapshot();
    expect(state.trackingEnabled).toBe(true);
    expect(state.isBusy).toBe(false);
    expect(state.lastError).toBeNull();
  });

  test('startTracking surfaces native failures as lastError', async () => {
    const harness = createHarness({failStart: true});

    await harness.viewModel.startTracking();

    const state = harness.viewModel.getSnapshot();
    expect(state.lastError).toBe('permission denied');
    expect(state.isBusy).toBe(false);
    expect(state.trackingEnabled).toBe(false);
  });

  test('stopTracking stops the service', async () => {
    const harness = createHarness();
    await harness.viewModel.startTracking();

    await harness.viewModel.stopTracking();

    expect(harness.stopCount).toBe(1);
    expect(harness.viewModel.getSnapshot().trackingEnabled).toBe(false);
  });

  test('sendPanic works even while tracking is OFF', async () => {
    const harness = createHarness();

    const result = await harness.viewModel.sendPanic();

    expect(result?.delivered).toBe(true);
    const state = harness.viewModel.getSnapshot();
    expect(state.lastPanicAtUtc).toBe('2026-11-12T11:20:00Z');
    expect(state.lastPanicQueued).toBe(false);
    expect(state.lastError).toBeNull();
    expect(state.trackingEnabled).toBe(false); // tracking never started
  });

  test('sendPanic marks the offline queue fallback in the view state', async () => {
    const harness = createHarness({transportFailures: 3});

    const result = await harness.viewModel.sendPanic();

    expect(result?.queued).toBe(true);
    expect(harness.queuedPanics).toHaveLength(1);
    const state = harness.viewModel.getSnapshot();
    expect(state.lastPanicQueued).toBe(true);
    expect(state.lastError).toBe('Offline: panic saved for delivery');
  });

  test('ignores a second panic while a command is running', async () => {
    let releaseTransport: () => void = () => undefined;
    const gate = new Promise<void>(resolve => {
      releaseTransport = resolve;
    });
    const harness = createHarness({transportGate: gate});

    const first = harness.viewModel.sendPanic();
    await Promise.resolve(); // let the command set isBusy
    const second = await harness.viewModel.sendPanic();
    expect(second).toBeNull();

    releaseTransport();
    const firstResult = await first;
    expect(firstResult?.delivered).toBe(true);
    expect(harness.sentPanics).toHaveLength(1);
  });
});
