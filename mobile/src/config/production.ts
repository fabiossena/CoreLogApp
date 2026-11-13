/**
 * Production configuration overrides.
 *
 * Replace the placeholder base URL with the real CoreLog endpoint **before**
 * building the store artifact (HTTPS only). `vehicleId` stays `UNBOUND` until
 * the device is registered / receives its first FCM command.
 *
 * Bare React Native does not load `.env` files, so these values are injected by
 * the composition root (`src/App.tsx`).
 */
import type {AppEnvOverrides} from './env';

/** Values injected by the composition root in release builds. */
export const PRODUCTION_ENV_OVERRIDES: AppEnvOverrides = {
  coreLogBaseUrl: 'https://api.corelog.example.com',
  vehicleId: 'UNBOUND',
  batchSize: 10,
  positionIntervalSeconds: 60,
};
