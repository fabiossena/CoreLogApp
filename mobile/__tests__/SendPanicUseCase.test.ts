/**
 * Unit tests for `SendPanicUseCase` (mocked transport/queue/position source).
 */
import {
  PANIC_MAX_ATTEMPTS,
  SendPanicUseCase,
} from '../src/domain/usecases/SendPanicUseCase';
import {PanicEvent} from '../src/domain/entities/PanicEvent';
import {Position} from '../src/domain/entities/Position';

const FIXED_DATE = new Date('2026-11-12T11:20:00.123Z');

const lastKnownPosition: Position = {
  vehicleId: 'VEH-001',
  latitude: 41.1579,
  longitude: -8.6291,
  timestampUtc: '2026-11-12T11:19:40Z',
  speedKmh: 72.5,
};

interface Harness {
  useCase: SendPanicUseCase;
  sent: PanicEvent[];
  queued: PanicEvent[];
  delays: number[];
  positionSource: Position | null;
}

function createHarness(options: {
  failures?: number;
  position?: Position | null;
  queueFails?: boolean;
} = {}): Harness {
  const failures = options.failures ?? 0;
  const sent: PanicEvent[] = [];
  const queued: PanicEvent[] = [];
  const delays: number[] = [];
  let attempts = 0;

  const harness: Harness = {
    sent,
    queued,
    delays,
    positionSource: options.position === undefined ? lastKnownPosition : options.position,
    useCase: undefined as unknown as SendPanicUseCase,
  };

  harness.useCase = new SendPanicUseCase({
    transport: {
      sendPanic: async event => {
        attempts += 1;
        if (attempts <= failures) {
          throw new Error('network down');
        }
        sent.push(event);
      },
    },
    queue: {
      enqueuePanic: async event => {
        if (options.queueFails) {
          throw new Error('disk full');
        }
        queued.push(event);
      },
    },
    positionSource: {
      getLastKnownPosition: async () => harness.positionSource,
    },
    generateEventId: () => '9f1c5b0e-3d2a-4f77-9c11-0a2b3c4d5e6f',
    clock: () => FIXED_DATE,
    delay: async ms => {
      delays.push(ms);
    },
  });

  return harness;
}

describe('SendPanicUseCase', () => {
  test('delivers the panic on the first attempt with the contract payload', async () => {
    const harness = createHarness();

    const result = await harness.useCase.execute('VEH-001');

    expect(result).toEqual({
      eventId: '9f1c5b0e-3d2a-4f77-9c11-0a2b3c4d5e6f',
      delivered: true,
      queued: false,
      attempts: 1,
      timestampUtc: '2026-11-12T11:20:00Z',
    });
    expect(harness.sent).toHaveLength(1);
    expect(harness.queued).toHaveLength(0);

    const event = harness.sent[0];
    expect(event.vehicleId).toBe('VEH-001');
    expect(event.source).toBe('MobileApp');
    expect(event.timestampUtc).toBe('2026-11-12T11:20:00Z');
    expect(event.lastKnownPosition).toEqual(lastKnownPosition);
  });

  test('retries up to 3 attempts and succeeds when the network recovers', async () => {
    const harness = createHarness({failures: 2});

    const result = await harness.useCase.execute('VEH-001');

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(3);
    expect(harness.queued).toHaveLength(0);
    // Backoff between attempts: 250ms, 500ms.
    expect(harness.delays).toEqual([250, 500]);
  });

  test('falls back to the high-priority queue after all 3 attempts fail', async () => {
    const harness = createHarness({failures: PANIC_MAX_ATTEMPTS});

    const result = await harness.useCase.execute('VEH-001');

    expect(result.delivered).toBe(false);
    expect(result.queued).toBe(true);
    expect(result.attempts).toBe(PANIC_MAX_ATTEMPTS);
    expect(harness.sent).toHaveLength(0);
    expect(harness.queued).toHaveLength(1);
    expect(harness.queued[0].source).toBe('MobileApp');
    expect(harness.delays).toHaveLength(PANIC_MAX_ATTEMPTS - 1);
  });

  test('sends null last_known_position when no position exists yet', async () => {
    const harness = createHarness({position: null});

    const result = await harness.useCase.execute('VEH-002');

    expect(result.delivered).toBe(true);
    expect(harness.sent[0].lastKnownPosition).toBeNull();
    expect(harness.sent[0].vehicleId).toBe('VEH-002');
  });

  test('does not depend on tracking state (no tracking check at all)', async () => {
    const harness = createHarness();

    // The use case only needs the injected ports — there is no tracking gate.
    const result = await harness.useCase.execute('VEH-001');

    expect(result.delivered).toBe(true);
    expect(harness.sent[0].eventId).toBe('9f1c5b0e-3d2a-4f77-9c11-0a2b3c4d5e6f');
  });
});
