/**
 * Unit tests for `StartTrackingUseCase`.
 */
import {
  StartTrackingUseCase,
  TrackingActivator,
} from '../src/domain/usecases/StartTrackingUseCase';

describe('StartTrackingUseCase', () => {
  test('starts tracking with the configured default interval', async () => {
    const calls: number[] = [];
    const activator: TrackingActivator = {
      startTracking: async interval => {
        calls.push(interval);
      },
    };
    const useCase = new StartTrackingUseCase(activator, 60);

    await useCase.execute();

    expect(calls).toEqual([60]);
  });

  test('honours a per-call interval override', async () => {
    const calls: number[] = [];
    const activator: TrackingActivator = {
      startTracking: async interval => {
        calls.push(interval);
      },
    };
    const useCase = new StartTrackingUseCase(activator, 60);

    await useCase.execute({intervalSeconds: 15});

    expect(calls).toEqual([15]);
  });

  test('propagates native failures to the caller (view state)', async () => {
    const activator: TrackingActivator = {
      startTracking: async () => {
        throw new Error('foreground service refused to start');
      },
    };
    const useCase = new StartTrackingUseCase(activator, 60);

    await expect(useCase.execute()).rejects.toThrow('foreground service refused to start');
  });
});
