/**
 * Stop-tracking use case.
 *
 * Counterpart of {@link StartTrackingUseCase}: stops native background
 * position collection through the {@link TrackingTerminator} port (DIP — the
 * concrete bridge lives in the infrastructure layer).
 */

/** Port implemented by the background-service bridge. */
export interface TrackingTerminator {
  /**
   * Stops native background position collection and dismisses the
   * foreground-service notification (Android).
   */
  stopTracking(): Promise<void>;
}

/**
 * Stops background tracking for the current vehicle.
 *
 * @remarks
 * Buffered positions and queued panics are **not** discarded: the offline
 * buffer is drained by the service on the next start / connectivity restore.
 */
export class StopTrackingUseCase {
  /**
   * @param terminator - port to the native background service.
   */
  constructor(private readonly terminator: TrackingTerminator) {}

  /**
   * Stops tracking.
   *
   * @returns a promise that resolves once the native service has stopped.
   * @throws when the native service fails to stop (surfaced as view state).
   */
  async execute(): Promise<void> {
    await this.terminator.stopTracking();
  }
}
