/**
 * Jest stub for `react-native-sqlite-storage` (moduleNameMapper target).
 *
 * The real library opens a native database; tests inject an in-memory
 * {@link SqliteExecutor} instead. This stub only has to satisfy the lazy
 * `require` inside `createNativeSqliteExecutor`.
 */

export function enablePromise(_enable: boolean): void {
  // No-op in tests.
}

export async function openDatabase(_config: {name: string; location?: string}): Promise<{
  executeSql(_sql: string, _params?: unknown[]): Promise<unknown[]>;
}> {
  return {
    async executeSql(): Promise<unknown[]> {
      return [];
    },
  };
}

export default {enablePromise, openDatabase};
