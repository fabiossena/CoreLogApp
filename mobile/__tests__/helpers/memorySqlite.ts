/**
 * In-memory {@link SqliteExecutor} test double.
 *
 * Understands exactly the statements issued by `PositionBuffer` (which are
 * fixed), so data-layer tests never need a device or a native SQLite build.
 */
import {SqliteExecutor, SqliteStatementResult} from '../../src/data/local/PositionBuffer';

interface MemoryRow {
  id: number;
  payload: string;
}

/** Creates a fresh in-memory buffer executor. */
export function createMemorySqliteExecutor(): SqliteExecutor {
  let rows: MemoryRow[] = [];
  let nextId = 1;
  let lastInsertId = 0;

  return {
    async executeSql(sql: string, params: unknown[] = []): Promise<SqliteStatementResult> {
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (/^CREATE TABLE/i.test(normalized)) {
        return {rows: [], rowsAffected: 0};
      }
      if (/^INSERT INTO tracking_events/i.test(normalized)) {
        const id = nextId;
        nextId += 1;
        rows.push({id, payload: String(params[0])});
        lastInsertId = id;
        return {rows: [], rowsAffected: 1};
      }
      if (/^SELECT id, payload FROM tracking_events ORDER BY id ASC LIMIT/i.test(normalized)) {
        const limit = Number(params[0]);
        const page = rows.slice(0, limit).map(row => ({id: row.id, payload: row.payload}));
        return {rows: page, rowsAffected: 0};
      }
      if (/^DELETE FROM tracking_events WHERE id IN/i.test(normalized)) {
        const ids = params.map(Number);
        const before = rows.length;
        rows = rows.filter(row => !ids.includes(row.id));
        return {rows: [], rowsAffected: before - rows.length};
      }
      if (/^DELETE FROM tracking_events WHERE id NOT IN/i.test(normalized)) {
        const keep = Number(params[0]);
        const sorted = [...rows].sort((a, b) => b.id - a.id);
        const allowed = new Set(sorted.slice(0, keep).map(row => row.id));
        const before = rows.length;
        rows = rows.filter(row => allowed.has(row.id));
        return {rows: [], rowsAffected: before - rows.length};
      }
      if (/^SELECT COUNT\(\*\) AS n/i.test(normalized)) {
        return {rows: [{n: rows.length}], rowsAffected: 0};
      }
      if (/last_insert_rowid/i.test(normalized)) {
        return {rows: [{id: lastInsertId}], rowsAffected: 0};
      }
      throw new Error(`createMemorySqliteExecutor: unsupported SQL: ${normalized}`);
    },
  };
}
