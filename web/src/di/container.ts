/**
 * Manual Dependency Injection container.
 *
 * This module is the only place that knows about the concrete `LocalCache`,
 * `CoreLogClient` and `SignalRClient` classes. Viewmodels receive the
 * `ICoreLogClient` / `ITrackingRealtime` interfaces, never the concrete
 * implementations (Dependency Inversion), which is what makes them trivially
 * testable with mocks.
 *
 * Wiring (one composition root):
 *
 *   loadConfig() ─► LocalCache ─► CoreLogClient ─┐
 *                    config ─► SignalRClient ────┴─► Container ─► viewmodels
 */

import { createContext, useContext } from 'react';
import {
  DEFAULT_LIST_CACHE_TTL_MS,
  LocalCache,
  type CacheLike,
} from '../data/cache/localCache';
import { CoreLogClient, type ICoreLogClient } from '../data/api/CoreLogClient';
import { SignalRClient, type ITrackingRealtime } from '../realtime/SignalRClient';

/** Runtime configuration resolved from environment variables. */
export interface AppConfig {
  /** Base URL of the CoreLog REST API (no trailing slash). */
  coreLogBaseUrl: string;
  /** Absolute URL of the TrackingHub. */
  signalrHubUrl: string;
  /** Operator identity used for panic acknowledgements. */
  operator: string;
  /** TTL for cached list queries, in milliseconds. */
  cacheTtlMs: number;
}

/** Default operator used when no environment variable is configured. */
const DEFAULT_OPERATOR = 'web.operator';

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Builds the application configuration from environment variables.
 *
 * Vite only exposes `VITE_`-prefixed variables to the client bundle; the
 * unprefixed `CORELOG_BASE_URL` / `SIGNALR_HUB_URL` keys are accepted as
 * server-side parity fallbacks. A relative hub path (e.g. `/hubs/tracking`)
 * is resolved against the CoreLog base URL.
 *
 * `VITE_CORELOG_BASE_URL=same-origin` (or an empty value) resolves to `""`,
 * which makes every REST call and the SignalR hub use the page's own origin —
 * the deployment shape used by Docker/Kubernetes, where nginx reverse-proxies
 * `/api` and `/hubs` to the backend (see `docker/nginx.conf.template`).
 *
 * @param env - Environment map (defaults to `import.meta.env`; injectable for tests).
 * @returns The resolved configuration.
 */
export function loadConfig(
  env: Record<string, unknown> = import.meta.env as Record<string, unknown>,
): AppConfig {
  const rawBase =
    readString(env.VITE_CORELOG_BASE_URL) ??
    readString(env.CORELOG_BASE_URL) ??
    'http://localhost:8090';
  // `same-origin` (case-insensitive) means "call back to this page's origin".
  const coreLogBaseUrl =
    rawBase.toLowerCase() === 'same-origin' ? '' : rawBase.replace(/\/+$/, '');
  const rawHub =
    readString(env.VITE_SIGNALR_HUB_URL) ?? readString(env.SIGNALR_HUB_URL) ?? '/hubs/tracking';
  const signalrHubUrl = /^https?:\/\//i.test(rawHub)
    ? rawHub
    : `${coreLogBaseUrl}${rawHub.startsWith('/') ? rawHub : `/${rawHub}`}`;
  return {
    coreLogBaseUrl,
    signalrHubUrl,
    operator: readString(env.VITE_OPERATOR_ID) ?? DEFAULT_OPERATOR,
    cacheTtlMs: readNumber(env.VITE_CACHE_TTL_MS) ?? DEFAULT_LIST_CACHE_TTL_MS,
  };
}

/** The wired application services handed to the viewmodels. */
export interface Container {
  /** Resolved configuration. */
  config: AppConfig;
  /** Local TTL cache used by the REST client. */
  cache: CacheLike;
  /** CoreLog REST client (abstraction used by viewmodels). */
  api: ICoreLogClient;
  /** TrackingHub client (abstraction used by viewmodels). */
  realtime: ITrackingRealtime;
}

/** Overrides accepted by {@link createContainer} (tests inject mocks here). */
export interface ContainerOverrides {
  config?: AppConfig;
  cache?: CacheLike;
  api?: ICoreLogClient;
  realtime?: ITrackingRealtime;
}

/**
 * Composition root: constructs the cache, the REST client and the SignalR
 * client, and returns them as a single object for the viewmodels.
 *
 * @param overrides - Optional injected implementations (used by tests).
 * @returns The wired container.
 */
export function createContainer(overrides: ContainerOverrides = {}): Container {
  const config = overrides.config ?? loadConfig();
  const cache = overrides.cache ?? new LocalCache();
  const api =
    overrides.api ??
    new CoreLogClient({
      baseUrl: config.coreLogBaseUrl,
      cache,
      cacheTtlMs: config.cacheTtlMs,
    });
  const realtime = overrides.realtime ?? new SignalRClient(config.signalrHubUrl);
  return { config, cache, api, realtime };
}

/** React context carrying the container from `App` down to the pages. */
export const ContainerContext = createContext<Container | null>(null);

/**
 * Consumes the wired container inside a page/component.
 *
 * @throws {Error} When used outside `<ContainerContext.Provider>`.
 * @returns The application container.
 */
export function useContainer(): Container {
  const container = useContext(ContainerContext);
  if (container === null) {
    throw new Error('useContainer must be used within a <ContainerContext.Provider>.');
  }
  return container;
}
