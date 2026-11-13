/**
 * Jest stub for `@react-native-firebase/analytics` (moduleNameMapper target).
 */

const events: Array<{name: string; params?: Record<string, string | number>}> = [];

const analytics = {
  async logEvent(name: string, params?: Record<string, string | number>): Promise<null> {
    events.push({name, params});
    return null;
  },
  /** Test helper: recorded events. */
  __events(): ReadonlyArray<{name: string; params?: Record<string, string | number>}> {
    return events;
  },
  /** Test helper: reset state between tests. */
  __reset(): void {
    events.length = 0;
  },
};

export default function analyticsFactory(): typeof analytics {
  return analytics;
}
