/**
 * Jest stub for `react-native` (moduleNameMapper target).
 *
 * Tests run in the Node environment: only the tiny surface imported by the
 * modules under test is provided. Native components are never rendered.
 */

/** Empty module registry — native modules are injected explicitly in tests. */
export const NativeModules: Record<string, unknown> = {};

/** No-op event emitter compatible with `new NativeEventEmitter(module)`. */
export class NativeEventEmitter {
  constructor(_nativeModule?: unknown) {}

  addListener(_eventName: string): {remove(): void} {
    return {
      remove: () => undefined,
    };
  }

  removeAllListeners(_eventName?: string): void {
    // No-op in tests.
  }
}

/** Minimal `Platform` stub. */
export const Platform = {
  OS: 'test' as 'ios' | 'android' | 'windows' | 'macos' | 'web',
  select<T>(spec: {ios?: T; android?: T; default?: T}): T | undefined {
    return spec.default;
  },
};

/** Minimal `StyleSheet.create` stub (identity function). */
export const StyleSheet = {
  create<T extends Record<string, unknown>>(styles: T): T {
    return styles;
  },
};
