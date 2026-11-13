/**
 * Runtime configuration for the CoreLog mobile app.
 *
 * The four keys required by the app come from `.env` (see `.env.example`):
 * `CORELOG_BASE_URL`, `FCM_SENDER_ID`, `BATCH_SIZE`, `POSITION_INTERVAL_SECONDS`.
 *
 * In bare React Native there is no built-in dotenv loader, so values are read
 * from `process.env` when present (Jest, CI, Metro `--env-file`) and can be
 * overridden explicitly by the composition root (e.g. when a native config
 * bridge such as `react-native-config` is wired in). Every key has a safe
 * default so the app boots even before configuration is injected.
 */

/** Resolved application configuration (snake_case wire keys are mapped elsewhere). */
export interface AppEnv {
  /** Base URL of the CoreLog backend, no trailing slash. */
  coreLogBaseUrl: string;
  /** Firebase Cloud Messaging sender id used by CoreLog to address this device. */
  fcmSenderId: string;
  /** Maximum number of positions per `POST /api/tracking/events` batch. */
  batchSize: number;
  /** Seconds between two native position samples (baseline, remote commands may change it). */
  positionIntervalSeconds: number;
  /**
   * Vehicle bound to this installation (`vehicle_id` in every payload).
   * Normally injected by the device-registration flow / first FCM command
   * (`device_id`); may be supplied through the optional `VEHICLE_ID` key.
   */
  vehicleId: string;
}

/** Partial configuration used by {@link loadAppEnv} overrides. */
export type AppEnvOverrides = Partial<AppEnv>;

const DEFAULTS: AppEnv = {
  coreLogBaseUrl: 'http://localhost:3000',
  fcmSenderId: '',
  batchSize: 10,
  positionIntervalSeconds: 60,
  vehicleId: 'UNBOUND',
};

/** Minimal view of `process.env` so this module does not depend on Node typings. */
interface EnvSource {
  [key: string]: string | undefined;
}

function readProcessEnv(): EnvSource {
  // `process` exists in Jest/Node and is injected by Metro in dev/release JS.
  const globalProcess = (globalThis as { process?: { env?: EnvSource } }).process;
  return globalProcess?.env ?? {};
}

function readPositiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Loads the application configuration.
 *
 * @param overrides - values injected by the composition root; they win over `process.env`.
 * @param source - environment source, injectable for tests (defaults to `process.env`).
 * @returns the fully resolved {@link AppEnv}.
 *
 * @example
 * ```ts
 * const env = loadAppEnv({ vehicleId: 'VEH-001' });
 * ```
 */
export function loadAppEnv(overrides: AppEnvOverrides = {}, source?: EnvSource): AppEnv {
  const env = source ?? readProcessEnv();
  return {
    coreLogBaseUrl:
      overrides.coreLogBaseUrl ??
      env.CORELOG_BASE_URL?.trim().replace(/\/+$/, '') ??
      DEFAULTS.coreLogBaseUrl,
    fcmSenderId: overrides.fcmSenderId ?? env.FCM_SENDER_ID?.trim() ?? DEFAULTS.fcmSenderId,
    batchSize: overrides.batchSize ?? readPositiveInteger(env.BATCH_SIZE, DEFAULTS.batchSize),
    positionIntervalSeconds:
      overrides.positionIntervalSeconds ??
      readPositiveInteger(env.POSITION_INTERVAL_SECONDS, DEFAULTS.positionIntervalSeconds),
    vehicleId: overrides.vehicleId ?? (env.VEHICLE_ID?.trim() || DEFAULTS.vehicleId),
  };
}
