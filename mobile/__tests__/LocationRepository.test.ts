/**
 * Unit tests for `LocationRepository` (offline buffer + batch flush,
 * in-memory SQLite, mocked batch sender).
 */
import {LocationRepository} from '../src/data/repositories/LocationRepository';
import {
  BatchAccepted,
  PositionBatchSender,
  TrackingEventDto,
} from '../src/infrastructure/http/CoreLogApiClient';
import {createMemorySqliteExecutor} from './helpers/memorySqlite';

class FakeSender implements PositionBatchSender {
  calls: TrackingEventDto[][] = [];
  failures = 0;

  async sendPositionBatch(events: TrackingEventDto[]): Promise<BatchAccepted> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('service unavailable');
    }
    this.calls.push(events);
    return {accepted: events.length, rejected: 0};
  }
}

function createRepository(batchSize = 2): {repository: LocationRepository; sender: FakeSender} {
  const sender = new FakeSender();
  const repository = new LocationRepository({
    sender,
    executor: createMemorySqliteExecutor(),
    batchSize,
  });
  return {repository, sender};
}

describe('LocationRepository', () => {
  test('buffers positions and flushes them as a snake_case batch', async () => {
    const {repository, sender} = createRepository();

    await repository.enqueuePosition({
      vehicleId: 'VEH-001',
      latitude: 41.1579,
      longitude: -8.6291,
      timestampUtc: '2026-11-12T11:20:00Z',
      speedKmh: 72.5,
    });
    await repository.enqueuePosition({
      vehicleId: 'VEH-001',
      latitude: 41.1496,
      longitude: -8.611,
      timestampUtc: '2026-11-12T11:21:00Z',
    });

    expect(await repository.getPendingCount()).toBe(2);

    const sent = await repository.flush();

    expect(sent).toBe(2);
    expect(await repository.getPendingCount()).toBe(0);
    expect(sender.calls[0]).toEqual([
      {
        vehicle_id: 'VEH-001',
        latitude: 41.1579,
        longitude: -8.6291,
        timestamp_utc: '2026-11-12T11:20:00Z',
        speed_kmh: 72.5,
      },
      {
        vehicle_id: 'VEH-001',
        latitude: 41.1496,
        longitude: -8.611,
        timestamp_utc: '2026-11-12T11:21:00Z',
      },
    ]);
  });

  test('respects BATCH_SIZE when flushing', async () => {
    const {repository, sender} = createRepository(2);
    for (let index = 0; index < 5; index += 1) {
      await repository.enqueuePosition({
        vehicleId: 'VEH-001',
        latitude: 41,
        longitude: -8,
        timestampUtc: `2026-11-12T11:2${index}:00Z`,
      });
    }

    const sent = await repository.flush();

    expect(sent).toBe(2);
    expect(sender.calls[0]).toHaveLength(2);
    expect(await repository.getPendingCount()).toBe(3);
  });

  test('keeps rows when the transport fails (at-least-once delivery)', async () => {
    const {repository, sender} = createRepository();
    await repository.enqueuePosition({
      vehicleId: 'VEH-001',
      latitude: 41,
      longitude: -8,
      timestampUtc: '2026-11-12T11:20:00Z',
    });
    sender.failures = 1;

    await expect(repository.flush()).rejects.toThrow('service unavailable');
    expect(await repository.getPendingCount()).toBe(1);

    const sent = await repository.flush();
    expect(sent).toBe(1);
    expect(await repository.getPendingCount()).toBe(0);
  });

  test('flush on an empty buffer is a no-op', async () => {
    const {repository, sender} = createRepository();

    expect(await repository.flush()).toBe(0);
    expect(sender.calls).toHaveLength(0);
  });
});
