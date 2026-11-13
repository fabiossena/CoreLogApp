/**
 * Integration tests for `BackgroundServiceBridge` and the delivery pipeline.
 *
 * Gated behind `RUN_BRIDGE_INTEGRATION_TESTS=1` (skipped otherwise) because
 * they exercise a real HTTP round-trip against an in-process server:
 *
 * ```
 * RUN_BRIDGE_INTEGRATION_TESTS=1 npm test
 * ```
 *
 * No device and no external network are required — the "native module" is a
 * faithful in-process fake and CoreLog is a local `node:http` server.
 */
import * as http from 'http';
import {AddressInfo} from 'net';
import {
  BackgroundServiceBridge,
  BridgeEventEmitter,
  NativeBackgroundService,
  NativeTrackingState,
} from '../src/infrastructure/background/BackgroundServiceBridge';
import {loadAppEnv} from '../src/config/env';
import {CoreLogApiClient, toPanicRequestDto} from '../src/infrastructure/http/CoreLogApiClient';
import {LocationRepository} from '../src/data/repositories/LocationRepository';
import {SendPanicUseCase} from '../src/domain/usecases/SendPanicUseCase';
import {createMemorySqliteExecutor} from './helpers/memorySqlite';

const RUN_TESTS = process.env.RUN_BRIDGE_INTEGRATION_TESTS === '1';
const describeIntegration = RUN_TESTS ? describe : describe.skip;

// ---------------------------------------------------------------------------
// In-process CoreLog stand-in
// ---------------------------------------------------------------------------

interface RecordedRequest {
  path: string;
  body: unknown;
}

function createCoreLogServer(): {
  server: http.Server;
  url: () => string;
  requests: RecordedRequest[];
  attemptsFor: (path: string) => number;
  failNextOnce: (path: string) => void;
} {
  const requests: RecordedRequest[] = [];
  const attempts = new Map<string, number>();
  const failuresLeft = new Map<string, number>();

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const path = req.url ?? '';
      const count = (attempts.get(path) ?? 0) + 1;
      attempts.set(path, count);
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? (JSON.parse(raw) as unknown) : null;
      requests.push({path, body});

      const failures = failuresLeft.get(path) ?? 0;
      if (failures > 0) {
        failuresLeft.set(path, failures - 1);
        res.writeHead(503, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({title: 'Transient failure', status: 503, errors: {}}));
        return;
      }
      if (path === '/api/tracking/events') {
        const batch = Array.isArray(body) ? body : [];
        res.writeHead(202, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({accepted: batch.length, rejected: 0}));
        return;
      }
      if (path === '/api/panic') {
        res.writeHead(201, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({panic_id: '3b8f1f4a-0f6d-4a2a-9c5e-1f2a3b4c5d6e'}));
        return;
      }
      res.writeHead(404, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({title: 'Not found', status: 404, errors: {}}));
    });
  });

  return {
    server,
    requests,
    url: () => {
      const address = server.address() as AddressInfo;
      return `http://127.0.0.1:${address.port}`;
    },
    attemptsFor: path => attempts.get(path) ?? 0,
    failNextOnce: path => {
      failuresLeft.set(path, (failuresLeft.get(path) ?? 0) + 1);
    },
  };
}

// ---------------------------------------------------------------------------
// Faithful fake native module + emitter
// ---------------------------------------------------------------------------

class FakeEmitter implements BridgeEventEmitter {
  private readonly listeners: Array<(state: NativeTrackingState) => void> = [];

  addListener(_eventName: string, listener: (state: NativeTrackingState) => void): {
    remove(): void;
  } {
    this.listeners.push(listener);
    return {
      remove: () => {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
      },
    };
  }

  emit(state: NativeTrackingState): void {
    for (const listener of [...this.listeners]) {
      listener(state);
    }
  }
}

function createFakeNativeModule(): {
  module: NativeBackgroundService;
  calls: Array<{method: string; args: unknown[]}>;
  currentState: () => NativeTrackingState;
  update: (patch: Partial<NativeTrackingState>) => void;
} {
  const calls: Array<{method: string; args: unknown[]}> = [];
  let state: NativeTrackingState = {
    trackingEnabled: false,
    lastSendAtUtc: null,
    pendingCount: 0,
    silencedUntilUtc: null,
    intervalSeconds: 60,
  };

  const module: NativeBackgroundService = {
    start: async config => {
      calls.push({method: 'start', args: [config]});
      state = {...state, trackingEnabled: true, intervalSeconds: config.positionIntervalSeconds};
    },
    stop: async () => {
      calls.push({method: 'stop', args: []});
      state = {...state, trackingEnabled: false};
    },
    getState: async () => state,
    setPositionInterval: async seconds => {
      calls.push({method: 'setPositionInterval', args: [seconds]});
      state = {...state, intervalSeconds: seconds};
    },
    silence: async durationSeconds => {
      calls.push({method: 'silence', args: [durationSeconds]});
      state = {
        ...state,
        silencedUntilUtc: new Date(Date.now() + durationSeconds * 1000).toISOString(),
      };
    },
    reactivate: async () => {
      calls.push({method: 'reactivate', args: []});
      state = {...state, silencedUntilUtc: null};
    },
    requestImmediatePosition: async () => {
      calls.push({method: 'requestImmediatePosition', args: []});
    },
    enqueuePanic: async payload => {
      calls.push({method: 'enqueuePanic', args: [payload]});
    },
    getLastKnownPosition: async () => ({
      latitude: 41.1579,
      longitude: -8.6291,
      timestamp_utc: '2026-11-12T11:19:40Z',
      speed_kmh: 72.5,
    }),
    addListener: () => undefined,
    removeListeners: () => undefined,
  };

  return {
    module,
    calls,
    currentState: () => state,
    update: patch => {
      state = {...state, ...patch};
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIntegration('BackgroundServiceBridge (integration)', () => {
  let corelog: ReturnType<typeof createCoreLogServer>;
  let baseUrl: string;

  beforeAll(async () => {
    corelog = createCoreLogServer();
    await new Promise<void>(resolve => {
      corelog.server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = corelog.url();
  });

  afterAll(async () => {
    await new Promise<void>(resolve => {
      corelog.server.close(() => resolve());
    });
  });

  test('syncs native state to subscribers through the event emitter', async () => {
    const fake = createFakeNativeModule();
    const emitter = new FakeEmitter();
    const env = loadAppEnv({coreLogBaseUrl: baseUrl, vehicleId: 'VEH-001'});
    const bridge = new BackgroundServiceBridge({
      nativeModule: fake.module,
      eventEmitter: emitter,
      bgLocation: null,
      env,
    });

    const seen: boolean[] = [];
    const unsubscribe = bridge.subscribe(() => {
      seen.push(bridge.getState().trackingEnabled);
    });

    emitter.emit({
      trackingEnabled: true,
      lastSendAtUtc: '2026-11-12T11:20:00Z',
      pendingCount: 3,
      silencedUntilUtc: null,
      intervalSeconds: 30,
    });

    expect(seen).toEqual([true]);
    expect(bridge.getState().pendingCount).toBe(3);

    await bridge.startTracking(60);
    expect(bridge.isTrackingEnabled()).toBe(true);
    expect(fake.calls[0]).toEqual({
      method: 'start',
      args: [
        {
          positionIntervalSeconds: 60,
          batchSize: env.batchSize,
          coreLogBaseUrl: baseUrl,
          vehicleId: 'VEH-001',
        },
      ],
    });

    // Unsubscribing only detaches THIS listener; the bridge keeps its own
    // native subscription, so its state remains authoritative and fresh.
    const notificationsBeforeUnsubscribe = seen.length;
    unsubscribe();
    emitter.emit({
      trackingEnabled: false,
      lastSendAtUtc: null,
      pendingCount: 0,
      silencedUntilUtc: null,
      intervalSeconds: 60,
    });
    // ...the bridge state is still updated from the native event...
    expect(bridge.getState().trackingEnabled).toBe(false);
    // ...but the detached listener is no longer notified.
    expect(seen).toHaveLength(notificationsBeforeUnsubscribe);

    bridge.dispose();
  });

  test('applies remote commands through the native module', async () => {
    const fake = createFakeNativeModule();
    const emitter = new FakeEmitter();
    const env = loadAppEnv({coreLogBaseUrl: baseUrl, vehicleId: 'VEH-001'});
    const bridge = new BackgroundServiceBridge({
      nativeModule: fake.module,
      eventEmitter: emitter,
      bgLocation: null,
      env,
    });

    await bridge.applyRemoteCommand({
      commandId: 'c1',
      deviceId: 'VEH-001',
      commandType: 'SET_FREQUENCY',
      seconds: 30,
    });
    await bridge.applyRemoteCommand({
      commandId: 'c2',
      deviceId: 'VEH-001',
      commandType: 'SILENCE',
      durationSeconds: 600,
    });
    await bridge.applyRemoteCommand({
      commandId: 'c3',
      deviceId: 'VEH-001',
      commandType: 'REACTIVATE',
    });

    expect(fake.calls.map(call => call.method)).toEqual([
      'setPositionInterval',
      'silence',
      'reactivate',
    ]);
    expect(bridge.getState().intervalSeconds).toBe(30);
    expect(bridge.getState().silencedUntilUtc).toBeNull();

    bridge.dispose();
  });

  test('delivers a panic end-to-end through the real HTTP client (contract payload)', async () => {
    const fake = createFakeNativeModule();
    const emitter = new FakeEmitter();
    const env = loadAppEnv({coreLogBaseUrl: baseUrl, vehicleId: 'VEH-001'});
    const bridge = new BackgroundServiceBridge({
      nativeModule: fake.module,
      eventEmitter: emitter,
      bgLocation: null,
      env,
    });
    const api = new CoreLogApiClient({
      baseUrl,
      retry: {maxRetries: 0, sleep: async () => undefined},
    });
    const useCase = new SendPanicUseCase({
      transport: {
        sendPanic: async event => {
          await api.sendPanic(toPanicRequestDto(event));
        },
      },
      queue: bridge,
      positionSource: bridge,
      generateEventId: () => '9f1c5b0e-3d2a-4f77-9c11-0a2b3c4d5e6f',
      clock: () => new Date('2026-11-12T11:20:00.000Z'),
      delay: async () => undefined,
    });

    const result = await useCase.execute('VEH-001');

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(1);

    const panicRequest = corelog.requests.find(req => req.path === '/api/panic');
    expect(panicRequest?.body).toEqual({
      event_id: '9f1c5b0e-3d2a-4f77-9c11-0a2b3c4d5e6f',
      vehicle_id: 'VEH-001',
      timestamp_utc: '2026-11-12T11:20:00Z',
      last_known_position: {
        latitude: 41.1579,
        longitude: -8.6291,
        timestamp_utc: '2026-11-12T11:19:40Z',
        speed_kmh: 72.5,
      },
      source: 'MobileApp',
    });

    bridge.dispose();
    api.dispose();
  });

  test('queues the panic in the native SQLite queue when every attempt fails', async () => {
    const fake = createFakeNativeModule();
    const emitter = new FakeEmitter();
    const env = loadAppEnv({coreLogBaseUrl: baseUrl, vehicleId: 'VEH-001'});
    const bridge = new BackgroundServiceBridge({
      nativeModule: fake.module,
      eventEmitter: emitter,
      bgLocation: null,
      env,
    });
    const api = new CoreLogApiClient({
      baseUrl: 'http://127.0.0.1:1', // nothing listens here
      retry: {maxRetries: 0, sleep: async () => undefined},
    });
    const useCase = new SendPanicUseCase({
      transport: {
        sendPanic: async event => {
          await api.sendPanic(toPanicRequestDto(event));
        },
      },
      queue: bridge,
      positionSource: bridge,
      delay: async () => undefined,
    });

    const result = await useCase.execute('VEH-001');

    expect(result.delivered).toBe(false);
    expect(result.queued).toBe(true);
    expect(result.attempts).toBe(3);
    expect(fake.calls.filter(call => call.method === 'enqueuePanic')).toHaveLength(1);

    bridge.dispose();
    api.dispose();
  });

  test('retries a transient 503 and drains the offline buffer (LocationRepository)', async () => {
    const env = loadAppEnv({coreLogBaseUrl: baseUrl, vehicleId: 'VEH-001'});
    const api = new CoreLogApiClient({
      baseUrl,
      retry: {maxRetries: 3, baseDelayMs: 1, maxDelayMs: 4, sleep: async () => undefined},
    });
    const repository = new LocationRepository({
      sender: api,
      executor: createMemorySqliteExecutor(),
      batchSize: env.batchSize,
    });

    await repository.enqueuePosition({
      vehicleId: 'VEH-001',
      latitude: 41.1579,
      longitude: -8.6291,
      timestampUtc: '2026-11-12T11:20:00Z',
      speedKmh: 72.5,
    });

    // First attempt hits the injected 503, the retry succeeds with 202.
    corelog.failNextOnce('/api/tracking/events');
    const sent = await repository.flush();

    expect(sent).toBe(1);
    expect(corelog.attemptsFor('/api/tracking/events')).toBe(2);
    expect(await repository.getPendingCount()).toBe(0);

    const lastBatch = [...corelog.requests]
      .reverse()
      .find(req => req.path === '/api/tracking/events');
    expect(lastBatch?.body).toEqual([
      {
        vehicle_id: 'VEH-001',
        latitude: 41.1579,
        longitude: -8.6291,
        timestamp_utc: '2026-11-12T11:20:00Z',
        speed_kmh: 72.5,
      },
    ]);

    api.dispose();
  });
});
