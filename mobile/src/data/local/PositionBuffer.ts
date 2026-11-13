/**
 * Offline SQLite position buffer (data layer).
 *
 * Stores position payloads that could not be delivered yet as JSON rows so
 * they survive app restarts. The table schema mirrors the one used by the
 * native background service (`tracking_events`), which drains its own copy of
 * the same database while the app is closed.
 *
 * The buffer is deliberately transport-agnostic: it only persists
 * already-serialized payloads supplied by `LocationRepository`.
 */

/** Result of one SQL statement executed through {@link SqliteExecutor}. */
export interface SqliteStatementResult {
  /** Rows selected by the statement (each row is an object). */
  rows: ReadonlyArray<Record<string, unknown>>;
  /** Number of rows inserted/updated/deleted. */
  rowsAffected: number;
}

/** Minimal SQLite execution port, implemented by react-native-sqlite-storage. */
export interface SqliteExecutor {
  /**
   * Executes one SQL statement.
   *
   * @param sql - SQL text with `?` placeholders.
   * @param params - bound parameters.
   */
  executeSql(sql: string, params?: unknown[]): Promise<SqliteStatementResult>;
}

/** One buffered row ready to be re-sent. */
export interface BufferedEntry {
  /** Surrogate primary key of the buffer row. */
  id: number;
  /** Serialized payload (snake_case JSON, ready for the wire). */
  payloadJson: string;
}

/** Dependency shape of {@link PositionBuffer}. */
export interface PositionBufferDependencies {
  /** SQLite executor (native in the app, in-memory fake in tests). */
  db: SqliteExecutor;
  /** Upper bound of buffered rows; oldest rows are dropped beyond it. */
  maxRows?: number;
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS tracking_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload TEXT NOT NULL,
    created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
`;

/** Default cap so an offline device cannot grow the database without bound. */
export const DEFAULT_MAX_BUFFER_ROWS = 5000;

/**
 * SQLite-backed FIFO buffer for undelivered position payloads.
 *
 * @remarks
 * All methods are async and idempotent-safe; `take*` + `remove*` pairs let the
 * caller implement at-least-once delivery (rows are only deleted after a
 * successful send).
 */
export class PositionBuffer {
  private readonly db: SqliteExecutor;
  private readonly maxRows: number;
  private initialized = false;

  /**
   * @param dependencies - executor and optional row cap.
   */
  constructor(dependencies: PositionBufferDependencies) {
    this.db = dependencies.db;
    this.maxRows = dependencies.maxRows ?? DEFAULT_MAX_BUFFER_ROWS;
  }

  /**
   * Creates the buffer table if it does not exist. Safe to call repeatedly.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.db.executeSql(CREATE_TABLE_SQL);
    this.initialized = true;
  }

  /**
   * Appends one serialized position payload to the buffer.
   *
   * @param payloadJson - snake_case JSON of a `POST /api/tracking/events` item.
   * @returns the assigned row id.
   */
  async appendPosition(payloadJson: string): Promise<number> {
    await this.initialize();
    const result = await this.db.executeSql(
      'INSERT INTO tracking_events (payload) VALUES (?)',
      [payloadJson],
    );
    await this.enforceMaxRows();
    return result.rowsAffected > 0 ? await this.lastInsertId() : -1;
  }

  /**
   * Reads up to `limit` buffered payloads in insertion order.
   *
   * @param limit - maximum number of rows to read.
   * @returns the buffered entries (rows are kept until explicitly removed).
   */
  async takePositions(limit: number): Promise<BufferedEntry[]> {
    await this.initialize();
    const result = await this.db.executeSql(
      'SELECT id, payload FROM tracking_events ORDER BY id ASC LIMIT ?',
      [limit],
    );
    return result.rows.map(row => ({id: Number(row.id), payloadJson: String(row.payload)}));
  }

  /**
   * Removes rows after a successful send.
   *
   * @param ids - row ids to delete.
   */
  async removePositions(ids: number[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.initialize();
    const placeholders = ids.map(() => '?').join(', ');
    await this.db.executeSql(`DELETE FROM tracking_events WHERE id IN (${placeholders})`, ids);
  }

  /**
   * @returns number of currently buffered positions.
   */
  async countPositions(): Promise<number> {
    await this.initialize();
    const result = await this.db.executeSql('SELECT COUNT(*) AS n FROM tracking_events');
    return Number(result.rows[0]?.n ?? 0);
  }

  private async lastInsertId(): Promise<number> {
    const result = await this.db.executeSql('SELECT last_insert_rowid() AS id');
    return Number(result.rows[0]?.id ?? -1);
  }

  private async enforceMaxRows(): Promise<void> {
    await this.db.executeSql(
      'DELETE FROM tracking_events WHERE id NOT IN (' +
        'SELECT id FROM tracking_events ORDER BY id DESC LIMIT ?)',
      [this.maxRows],
    );
  }
}

/** Shape returned by `react-native-sqlite-storage` in promise mode. */
interface NativeSqliteDatabase {
  executeSql(sql: string, params?: unknown[]): Promise<unknown>;
}

/**
 * Creates a {@link SqliteExecutor} backed by `react-native-sqlite-storage`.
 *
 * @remarks
 * The native library is required lazily so that importing this module from
 * Jest (which maps `react-native-sqlite-storage` to a stub) never touches a
 * native runtime.
 *
 * @param databaseName - file name of the shared SQLite database
 *                       (`corelog_tracking.db`, same file used by the native
 *                       background service on Android).
 * @returns an executor bound to the opened database.
 */
export function createNativeSqliteExecutor(
  databaseName: string = 'corelog_tracking.db',
): SqliteExecutor {
  // Lazy require: native module, only used inside the running app.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SQLite = require('react-native-sqlite-storage') as {
    enablePromise(enable: boolean): void;
    openDatabase(config: {name: string; location?: string}): Promise<NativeSqliteDatabase>;
  };
  SQLite.enablePromise(true);
  let databasePromise: Promise<NativeSqliteDatabase> | null = null;

  const openDatabase = (): Promise<NativeSqliteDatabase> => {
    if (!databasePromise) {
      databasePromise = SQLite.openDatabase({name: databaseName, location: 'default'});
    }
    return databasePromise;
  };

  return {
    async executeSql(sql: string, params: unknown[] = []): Promise<SqliteStatementResult> {
      const database = await openDatabase();
      const raw = (await database.executeSql(sql, params)) as Array<{
        rows: {length: number; item(index: number): Record<string, unknown>};
        rowsAffected: number;
      }>;
      const first = raw[0];
      const rows: Array<Record<string, unknown>> = [];
      if (first?.rows) {
        for (let index = 0; index < first.rows.length; index += 1) {
          rows.push(first.rows.item(index));
        }
      }
      return {rows, rowsAffected: first?.rowsAffected ?? 0};
    },
  };
}
