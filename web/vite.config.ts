/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration for the CoreLog web dashboard.
 *
 * The `test` block configures Vitest (jsdom environment, explicit test files
 * under `__tests__/`). Tests never touch the network: the CoreLog REST client
 * and the SignalR client are always mocked.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['__tests__/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
