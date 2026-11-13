package com.corelog.mobile.background

import android.content.Context
import android.content.SharedPreferences
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Persistent configuration + runtime state of the background service,
 * stored in `SharedPreferences` so the WorkManager watchdog and the React
 * Native module observe the same values even after the process dies.
 */
class TrackingConfigStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** `CORELOG_BASE_URL` handed over by JavaScript on `start(config)`. */
    var baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, "") ?: ""
        set(value) = prefs.edit().putString(KEY_BASE_URL, value).apply()

    /** `vehicle_id` used in every payload. */
    var vehicleId: String
        get() = prefs.getString(KEY_VEHICLE_ID, "UNBOUND") ?: "UNBOUND"
        set(value) = prefs.edit().putString(KEY_VEHICLE_ID, value).apply()

    /** `BATCH_SIZE` — positions per `POST /api/tracking/events`. */
    var batchSize: Int
        get() = prefs.getInt(KEY_BATCH_SIZE, 10)
        set(value) = prefs.edit().putInt(KEY_BATCH_SIZE, value).apply()

    /** Seconds between two native samples (baseline, `SET_FREQUENCY` overrides). */
    var intervalSeconds: Int
        get() = prefs.getInt(KEY_INTERVAL_SECONDS, 60)
        set(value) = prefs.edit().putInt(KEY_INTERVAL_SECONDS, value).apply()

    /** User intent from the Start/Stop button (`tracking_enabled` on CoreLog). */
    var trackingEnabled: Boolean
        get() = prefs.getBoolean(KEY_TRACKING_ENABLED, false)
        set(value) = prefs.edit().putBoolean(KEY_TRACKING_ENABLED, value).apply()

    /** ISO-8601 UTC of the last successful batch upload, or null. */
    var lastSendAtUtc: String?
        get() = prefs.getString(KEY_LAST_SEND_AT, null)
        set(value) = prefs.edit().putString(KEY_LAST_SEND_AT, value).apply()

    /** Epoch millis until which sending is silenced (`SILENCE` command), 0 = none. */
    var silencedUntilMs: Long
        get() = prefs.getLong(KEY_SILENCED_UNTIL, 0L)
        set(value) = prefs.edit().putLong(KEY_SILENCED_UNTIL, value).apply()

    /** Whether a `SILENCE` window is currently active. */
    fun isSilenced(nowMs: Long = System.currentTimeMillis()): Boolean =
        silencedUntilMs > nowMs

    /** Clears the silence window (`REACTIVATE` command). */
    fun clearSilence() {
        silencedUntilMs = 0L
    }

    // -- last known position (used by panic `last_known_position`) -----------

    var lastKnownLatitude: Double?
        get() = if (prefs.contains(KEY_LAST_LAT)) prefs.getFloat(KEY_LAST_LAT, 0f).toDouble() else null
        set(value) = prefs.edit().putFloat(KEY_LAST_LAT, (value ?: 0.0).toFloat()).apply()

    var lastKnownLongitude: Double?
        get() = if (prefs.contains(KEY_LAST_LON)) prefs.getFloat(KEY_LAST_LON, 0f).toDouble() else null
        set(value) = prefs.edit().putFloat(KEY_LAST_LON, (value ?: 0.0).toFloat()).apply()

    var lastKnownTimestampUtc: String?
        get() = prefs.getString(KEY_LAST_TS, null)
        set(value) = prefs.edit().putString(KEY_LAST_TS, value).apply()

    var lastKnownSpeedKmh: Float?
        get() = if (prefs.contains(KEY_LAST_SPEED)) prefs.getFloat(KEY_LAST_SPEED, -1f) else null
        set(value) = prefs.edit().putFloat(KEY_LAST_SPEED, value ?: -1f).apply()

    companion object {
        private const val PREFS_NAME = "corelog_tracking_config"
        private const val KEY_BASE_URL = "corelog_base_url"
        private const val KEY_VEHICLE_ID = "vehicle_id"
        private const val KEY_BATCH_SIZE = "batch_size"
        private const val KEY_INTERVAL_SECONDS = "interval_seconds"
        private const val KEY_TRACKING_ENABLED = "tracking_enabled"
        private const val KEY_LAST_SEND_AT = "last_send_at_utc"
        private const val KEY_SILENCED_UNTIL = "silenced_until_ms"
        private const val KEY_LAST_LAT = "last_latitude"
        private const val KEY_LAST_LON = "last_longitude"
        private const val KEY_LAST_TS = "last_timestamp_utc"
        private const val KEY_LAST_SPEED = "last_speed_kmh"

        private val ISO_FORMAT = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }

        /** Formats epoch millis as ISO-8601 UTC (`2026-11-12T11:20:00Z`). */
        fun isoUtc(epochMs: Long): String = synchronized(ISO_FORMAT) {
            ISO_FORMAT.format(Date(epochMs))
        }
    }
}
