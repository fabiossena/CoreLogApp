/**
 * Installation tracker (infrastructure layer).
 *
 * Owns app-installation analytics used for **uninstall detection**:
 *
 * - **Android** — Firebase Analytics emits `app_remove` automatically when
 *   the app is uninstalled; a Cloud Function (`corelogOnAppRemove`, see
 *   README "Uninstall detection") forwards it to CoreLog's device-lifecycle
 *   API so the vehicle flips to `Offline`/retired without waiting for the
 *   position timeout.
 * - **iOS** — Apple forbids any post-uninstall execution, so detection relies
 *   on CoreLog-side timeout (no positions for N minutes ⇒ `PossiblyOffline`)
 *   plus invalid-FCM-token invalidation. This class documents that limitation
 *   via {@link InstallationTracker.IOS_UNINSTALL_STRATEGY} and only records
 *   install/open events.
 */

/** Port over `@react-native-firebase/analytics` (injectable for tests). */
export interface AnalyticsPort {
  /**
   * Logs a Firebase Analytics event.
   *
   * @param name - event name.
   * @param params - event parameters (snake_case values are strings/numbers).
   */
  logEvent(name: string, params?: Record<string, string | number>): Promise<unknown>;
}

/** Dependencies of {@link InstallationTracker}. */
export interface InstallationTrackerDependencies {
  /** Analytics port (defaults to `@react-native-firebase/analytics`). */
  analytics?: AnalyticsPort;
  /** Stable installation id factory (defaults to an in-memory uuid). */
  generateInstallId?: () => string;
  /** ISO clock (defaults to `() => new Date()`). */
  clock?: () => Date;
}

/**
 * Tracks installation lifecycle events that feed uninstall detection.
 */
export class InstallationTracker {
  /** Firebase auto-logged event fired when the app is uninstalled (Android). */
  static readonly APP_REMOVE_EVENT = 'app_remove';

  /**
   * Documented path of the `app_remove` signal:
   * Firebase Analytics → BigQuery/stream export → Cloud Function
   * `corelogOnAppRemove` → CoreLog device-lifecycle endpoint (backend-owned,
   * outside `docs/api-contract.md`).
   */
  static readonly APP_REMOVE_WEBHOOK_PATH =
    'functions/corelogOnAppRemove (Firebase Analytics app_remove trigger) -> CoreLog device lifecycle API';

  /** iOS limitation: no code runs after uninstall. */
  static readonly IOS_UNINSTALL_STRATEGY =
    'CoreLog-side timeout (no positions for N minutes => PossiblyOffline) + invalid FCM token detection';

  private readonly analytics: AnalyticsPort | undefined;
  private readonly generateInstallId: () => string;
  private readonly clock: () => Date;
  private readonly installId: string;

  /**
   * @param dependencies - injectable analytics port, id factory and clock.
   */
  constructor(dependencies: InstallationTrackerDependencies = {}) {
    this.analytics = dependencies.analytics;
    this.generateInstallId = dependencies.generateInstallId ?? (() => `install-${Date.now()}`);
    this.clock = dependencies.clock ?? (() => new Date());
    this.installId = this.generateInstallId();
  }

  /**
   * @returns the stable id of this installation.
   */
  getInstallId(): string {
    return this.installId;
  }

  /**
   * Records that the app was (re)installed/opened, binding the installation
   * id to the Firebase `app_remove` listener on the backend side.
   *
   * @returns `true` when the event reached the analytics SDK.
   */
  async trackInstall(): Promise<boolean> {
    return this.log('app_install', {
      installation_id: this.installId,
      installed_at_utc: this.clock().toISOString(),
    });
  }

  /**
   * Explicitly records an observed uninstall signal.
   *
   * On Android this is normally unnecessary (Firebase auto-logs
   * `app_remove`); it exists for the Cloud Function webhook replay path and
   * for tests. On iOS it is never raised by the client.
   *
   * @returns `true` when the event reached the analytics SDK.
   */
  async trackAppRemove(): Promise<boolean> {
    return this.log(InstallationTracker.APP_REMOVE_EVENT, {
      installation_id: this.installId,
      removed_at_utc: this.clock().toISOString(),
    });
  }

  private async log(name: string, params: Record<string, string | number>): Promise<boolean> {
    if (!this.analytics) {
      return false;
    }
    try {
      await this.analytics.logEvent(name, params);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Creates the default analytics port backed by `@react-native-firebase/analytics`.
 * Lazy-required so Jest never loads the native Firebase SDK.
 *
 * @returns the analytics port, or `undefined` when the SDK is unavailable.
 */
export function createFirebaseAnalyticsPort(): AnalyticsPort | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const analyticsModule = require('@react-native-firebase/analytics') as {
      default: () => AnalyticsPort;
    };
    return analyticsModule.default();
  } catch {
    return undefined;
  }
}
