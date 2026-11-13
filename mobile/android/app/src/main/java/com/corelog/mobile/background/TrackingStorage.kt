package com.corelog.mobile.background

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * SQLite offline buffer owned by the native layer.
 *
 * Uses the same database file as the JavaScript layer
 * (`react-native-sqlite-storage` opens `corelog_tracking.db`), so panics
 * enqueued from JavaScript are drained by this service and vice versa.
 *
 * Tables:
 *  - `tracking_events`: position payloads waiting for `POST /api/tracking/events`
 *  - `panic_queue`: high-priority panics, always drained first
 */
class TrackingStorage(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

    data class Row(val id: Long, val payload: String)

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS tracking_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              payload TEXT NOT NULL,
              created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS panic_queue (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              payload TEXT NOT NULL,
              attempts INTEGER NOT NULL DEFAULT 0,
              created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )
            """.trimIndent()
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Schema is created with IF NOT EXISTS; nothing to migrate yet.
    }

    // -- positions ------------------------------------------------------------

    fun appendPosition(payload: String) {
        val values = ContentValues().apply { put("payload", payload) }
        writableDatabase.insert("tracking_events", null, values)
    }

    fun takePositions(limit: Int): List<Row> {
        val rows = mutableListOf<Row>()
        readableDatabase.rawQuery(
            "SELECT id, payload FROM tracking_events ORDER BY id ASC LIMIT ?",
            arrayOf(limit.toString())
        ).use { cursor ->
            while (cursor.moveToNext()) {
                rows.add(Row(cursor.getLong(0), cursor.getString(1)))
            }
        }
        return rows
    }

    fun deletePositions(ids: List<Long>) {
        if (ids.isEmpty()) return
        val placeholders = ids.joinToString(", ") { "?" }
        writableDatabase.execSQL(
            "DELETE FROM tracking_events WHERE id IN ($placeholders)",
            ids.map { it.toString() }.toTypedArray()
        )
    }

    fun countPositions(): Int {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM tracking_events", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    // -- panics (high priority) ----------------------------------------------

    fun appendPanic(payload: String) {
        val values = ContentValues().apply { put("payload", payload) }
        writableDatabase.insert("panic_queue", null, values)
    }

    fun takePanics(limit: Int): List<Row> {
        val rows = mutableListOf<Row>()
        readableDatabase.rawQuery(
            "SELECT id, payload FROM panic_queue ORDER BY id ASC LIMIT ?",
            arrayOf(limit.toString())
        ).use { cursor ->
            while (cursor.moveToNext()) {
                rows.add(Row(cursor.getLong(0), cursor.getString(1)))
            }
        }
        return rows
    }

    fun deletePanic(id: Long) {
        writableDatabase.execSQL("DELETE FROM panic_queue WHERE id = ?", arrayOf(id.toString()))
    }

    fun countPanics(): Int {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM panic_queue", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    companion object {
        /** Shared with the JavaScript `PositionBuffer` (same file name). */
        const val DB_NAME = "corelog_tracking.db"
        const val DB_VERSION = 1
    }
}
