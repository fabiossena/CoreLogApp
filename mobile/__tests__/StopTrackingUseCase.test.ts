/**
 * Unit tests for `StopTrackingUseCase`.
 */
import {
  StopTrackingUseCase,
  TrackingTerminator,
} from '../src/domain/usecases/StopTrackingUseCase';

describe('StopTrackingUseCase', () => {
  test('stops tracking exactly once', async () => {
    let stopCount = 0;
    const terminator: TrackingTerminator = {
      stopTracking: async () => {
        stopCount += 1;
      },
    };
    const useCase = new StopTrackingUseCase(terminator);

    await useCase.execute();

    expect(stopCount).toBe(1);
  });

  test('propagates native failures to the caller (view state)', async () => {
    const terminator: TrackingTerminator = {
      stopTracking: async () => {
        throw new Error('service is not running');
      },
    };
    const useCase = new StopTrackingUseCase(terminator);

    await expect(useCase.execute()).rejects.toThrow('service is not running');
  });
});
