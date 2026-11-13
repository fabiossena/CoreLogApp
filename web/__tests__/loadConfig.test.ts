/**
 * Unit tests for the configuration loader (`loadConfig`).
 *
 * Covers the three deployment shapes the dashboard supports:
 *  1. Local development  — absolute CoreLog URL (e.g. http://localhost:8090).
 *  2. Docker/Kubernetes  — `same-origin`, so nginx proxies /api and /hubs.
 *  3. Relative hub path  — resolved against the configured base URL.
 */

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/di/container';

describe('loadConfig', () => {
  it('defaults to the local CoreLog backend when nothing is configured', () => {
    const config = loadConfig({});

    expect(config.coreLogBaseUrl).toBe('http://localhost:8090');
    expect(config.signalrHubUrl).toBe('http://localhost:8090/hubs/tracking');
  });

  it('reads the VITE_-prefixed values and strips trailing slashes', () => {
    const config = loadConfig({
      VITE_CORELOG_BASE_URL: 'https://corelog.example.com/',
      VITE_SIGNALR_HUB_URL: 'https://corelog.example.com/hubs/tracking',
      VITE_OPERATOR_ID: 'fabio.sena',
      VITE_CACHE_TTL_MS: '5000',
    });

    expect(config.coreLogBaseUrl).toBe('https://corelog.example.com');
    expect(config.signalrHubUrl).toBe('https://corelog.example.com/hubs/tracking');
    expect(config.operator).toBe('fabio.sena');
    expect(config.cacheTtlMs).toBe(5000);
  });

  it('supports same-origin so nginx can proxy /api and /hubs', () => {
    const config = loadConfig({ VITE_CORELOG_BASE_URL: 'same-origin' });

    // Empty base URL => every call uses the page's own origin.
    expect(config.coreLogBaseUrl).toBe('');
    // A relative hub path stays relative (resolved by the browser).
    expect(config.signalrHubUrl).toBe('/hubs/tracking');
  });

  it('accepts an absolute hub URL even when the base URL is same-origin', () => {
    const config = loadConfig({
      VITE_CORELOG_BASE_URL: 'same-origin',
      VITE_SIGNALR_HUB_URL: 'https://realtime.example.com/hubs/tracking',
    });

    expect(config.coreLogBaseUrl).toBe('');
    expect(config.signalrHubUrl).toBe('https://realtime.example.com/hubs/tracking');
  });

  it('falls back to the unprefixed keys (server-side parity)', () => {
    const config = loadConfig({
      CORELOG_BASE_URL: 'http://corelog:8090',
      SIGNALR_HUB_URL: 'http://corelog:8090/hubs/tracking',
    });

    expect(config.coreLogBaseUrl).toBe('http://corelog:8090');
    expect(config.signalrHubUrl).toBe('http://corelog:8090/hubs/tracking');
  });

  it('ignores invalid cache TTL values and keeps the default', () => {
    const config = loadConfig({ VITE_CACHE_TTL_MS: 'not-a-number' });

    expect(config.cacheTtlMs).toBeGreaterThan(0);
  });
});