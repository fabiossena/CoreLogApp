/**
 * Development-only configuration overrides.
 *
 * Bare React Native does not load `.env` files: `process.env` only carries the
 * values Metro/build tooling injects, so `src/config/env.ts` cannot read
 * `CORELOG_BASE_URL` from `mobile/.env` in a normal `npm run android` build.
 * The composition root therefore injects the local development values here.
 *
 * `10.0.2.2` is the Android emulator alias for the host machine. For a
 * physical device, replace it with the host LAN IP (e.g. 192.168.0.10).
 *
 * Backends:
 * - mock CoreLog contract (tools/mock-corelog): http://10.0.2.2:8099
 * - real CoreLog backend:                       http://10.0.2.2:8090
 *   (only ingestion/trips are implemented there; panic/commands return 404)
 */
import type {AppEnvOverrides} from './env';

/** Values injected by the composition root during local development. */
export const DEV_ENV_OVERRIDES: AppEnvOverrides = {
  coreLogBaseUrl: 'http://10.0.2.2:8099',
  vehicleId: 'VEH-001',
  batchSize: 1,
  positionIntervalSeconds: 15,
};
