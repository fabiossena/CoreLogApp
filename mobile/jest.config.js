/**
 * Jest configuration for the CoreLog mobile app.
 *
 * - `ts-jest` compiles TypeScript directly (no Babel, no Metro).
 * - `testEnvironment: node` so tests never need a device or a native runtime.
 * - `moduleNameMapper` stubs every native module so importing application
 *   code from Node.js is always safe (no `react-native` runtime required).
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/__tests__/stubs/react-native.ts',
    '^@react-native-firebase/messaging$': '<rootDir>/__tests__/stubs/fcm-messaging.ts',
    '^@react-native-firebase/analytics$': '<rootDir>/__tests__/stubs/fcm-analytics.ts',
    '^@bglocation/react-native$': '<rootDir>/__tests__/stubs/bglocation.ts',
    '^react-native-sqlite-storage$': '<rootDir>/__tests__/stubs/sqlite-storage.ts',
  },
  clearMocks: true,
  restoreMocks: true,
};
