//
//  CoreLogStore.swift
//  CoreLogMobile
//
//  Native SQLite offline queue used by the iOS background service.
//
//  Two tables, mirroring the Android `TrackingStorage`:
//    positions(event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER)
//    panics(event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER)
//
//  `payload` stores the exact JSON object that must be sent to CoreLog, so the
//  native side never has to re-serialise domain objects. `panics` is drained
//  with higher priority than `positions`.
//
//  The store is intentionally independent of the React Native JS thread: the
//  background location manager keeps writing/draining while the UI is closed.
//

import Foundation
import SQLite3

/// High-priority flag used when draining; panics are always sent first.
enum CoreLogQueueKind {
    case positions
    case panics
}

/// Row shape returned by the queue readers.
struct CoreLogStoredRow {
    /// The `event_id` primary key.
    let eventId: String
    /// The JSON payload to POST to CoreLog.
    let payload: String
}

/// SQLite-backed offline queue.
///
/// All methods are synchronous and guarded by an internal serial queue so they
/// can be called from the location delegate, the RN module or a background
/// URLSession completion handler without data races.
final class CoreLogStore {

    /// Shared instance (single database file per installation).
    static let shared = CoreLogStore()

    private let queue = DispatchQueue(label: "com.corelog.mobile.store")
    private var database: OpaquePointer?

    private init() {
        open()
        createSchema()
    }

    deinit {
        if let database = database {
            sqlite3_close(database)
        }
    }

    // MARK: - Schema

    private func open() {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let path = directory.appendingPathComponent("corelog_buffer.sqlite").path
        if sqlite3_open(path, &database) != SQLITE_OK {
            NSLog("[CoreLogStore] unable to open SQLite database at %@", path)
            database = nil
        }
    }

    private func createSchema() {
        execute("PRAGMA journal_mode = WAL;")
        execute("""
            CREATE TABLE IF NOT EXISTS positions (
                event_id   TEXT PRIMARY KEY,
                payload    TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            """)
        execute("""
            CREATE TABLE IF NOT EXISTS panics (
                event_id   TEXT PRIMARY KEY,
                payload    TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            """)
    }

    // MARK: - Writes

    /// Appends a position payload to the offline queue.
    ///
    /// - Parameters:
    ///   - payload: JSON object (single position) to persist.
    ///   - eventId: stable id; duplicates are ignored.
    func appendPosition(_ payload: String, eventId: String) {
        insert(kind: .positions, payload: payload, eventId: eventId)
    }

    /// Appends a panic payload to the high-priority queue.
    ///
    /// - Parameters:
    ///   - payload: JSON object (panic request) to persist.
    ///   - eventId: stable id; duplicates are ignored.
    func appendPanic(_ payload: String, eventId: String) {
        insert(kind: .panics, payload: payload, eventId: eventId)
    }

    private func insert(kind: CoreLogQueueKind, payload: String, eventId: String) {
        queue.sync {
            guard let database = database else { return }
            let sql = "INSERT OR IGNORE INTO \(table(kind)) (event_id, payload, created_at) VALUES (?, ?, ?);"
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(statement) }
            sqlite3_bind_text(statement, 1, (eventId as NSString).utf8String, -1, nil)
            sqlite3_bind_text(statement, 2, (payload as NSString).utf8String, -1, nil)
            sqlite3_bind_int64(statement, 3, Int64(Date().timeIntervalSince1970 * 1000))
            sqlite3_step(statement)
        }
    }

    // MARK: - Reads / drains

    /// Returns the oldest rows of a queue (FIFO).
    ///
    /// - Parameters:
    ///   - kind: queue to read.
    ///   - limit: maximum number of rows.
    /// - Returns: the rows, oldest first.
    func peek(kind: CoreLogQueueKind, limit: Int) -> [CoreLogStoredRow] {
        queue.sync {
            guard let database = database else { return [] }
            let sql = "SELECT event_id, payload FROM \(table(kind)) ORDER BY created_at ASC LIMIT ?;"
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { return [] }
            defer { sqlite3_finalize(statement) }
            sqlite3_bind_int(statement, 1, Int32(limit))

            var rows: [CoreLogStoredRow] = []
            while sqlite3_step(statement) == SQLITE_ROW {
                let eventId = String(cString: sqlite3_column_text(statement, 0))
                let payload = String(cString: sqlite3_column_text(statement, 1))
                rows.append(CoreLogStoredRow(eventId: eventId, payload: payload))
            }
            return rows
        }
    }

    /// Removes rows that were successfully delivered.
    ///
    /// - Parameters:
    ///   - kind: queue to delete from.
    ///   - eventIds: ids to delete.
    func delete(kind: CoreLogQueueKind, eventIds: [String]) {
        guard !eventIds.isEmpty else { return }
        queue.sync {
            guard let database = database else { return }
            for eventId in eventIds {
                let sql = "DELETE FROM \(table(kind)) WHERE event_id = ?;"
                var statement: OpaquePointer?
                guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { continue }
                sqlite3_bind_text(statement, 1, (eventId as NSString).utf8String, -1, nil)
                sqlite3_step(statement)
                sqlite3_finalize(statement)
            }
        }
    }

    /// Total number of buffered rows across both queues.
    func count() -> Int {
        queue.sync {
            count(kind: .positions) + count(kind: .panics)
        }
    }

    private func count(kind: CoreLogQueueKind) -> Int {
        guard let database = database else { return 0 }
        var statement: OpaquePointer?
        let sql = "SELECT COUNT(*) FROM \(table(kind));"
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { return 0 }
        defer { sqlite3_finalize(statement) }
        return sqlite3_step(statement) == SQLITE_ROW ? Int(sqlite3_column_int(statement, 0)) : 0
    }

    // MARK: - Helpers

    private func table(_ kind: CoreLogQueueKind) -> String {
        switch kind {
        case .positions: return "positions"
        case .panics: return "panics"
        }
    }

    private func execute(_ sql: String) {
        guard let database = database else { return }
        var error: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(database, sql, nil, nil, &error) != SQLITE_OK {
            if let error = error {
                NSLog("[CoreLogStore] SQL error: %@", String(cString: error))
                sqlite3_free(error)
            }
        }
    }
}
