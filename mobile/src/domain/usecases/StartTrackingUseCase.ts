/**
 * Start-tracking use case.
 *
 * The ViewModel never talks to the background service directly: it calls this
 * use case, which depends only on the {@link TrackingActivator} port. The
 * concrete implementation lives in the infrastructure layer
 * (`BackgroundServiceBridge`), injected by the composition root (DIP).
 */

/** Port implemented by the background-service bridge. */
export interface TrackingActivator {
  /**
   * Starts native background position collection.
   *
   * @param intervalSeconds - seconds between two native samples.
   */
  startTracking(intervalSeconds: number): Promise<void>;
}

/** Options accepted by {@link StartTrackingUseCase.execute}. */
export interface StartTrackingOptions {
  /** Overrides the configured sampling period for this start. */
  intervalSeconds?: number;
}

/**
 * Starts background tracking for the current vehicle.
 *
 * @remarks
 * Collection itself happens natively (foreground service on Android,
 * background location on iOS) — this use case only flips the switch.
 */
export class StartTrackingUseCase {
  /**
   * @param activator - port to the native background service.
   * @param defaultIntervalSeconds - baseline period from configuration.
   */
  constructor(
    private readonly activator: TrackingActivator,
    private readonly defaultIntervalSeconds: number,
  ) {}

  /**
   * Starts tracking.
   *
   * @param options - optional per-call overrides.
   * @returns a promise that resolves once the native service is running.
   * @throws when the native service fails to start (surfaced as view state).
   */
  async execute(options: StartTrackingOptions = {}): Promise<void> {
    const intervalSeconds = options.intervalSeconds ?? this.defaultIntervalSeconds;
    await this.activator.startTracking(intervalSeconds);
  }
}
