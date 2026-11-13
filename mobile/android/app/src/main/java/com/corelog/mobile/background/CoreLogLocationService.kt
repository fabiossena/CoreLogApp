package com.corelog.mobile.background

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/**
 * Foreground service that collects positions **natively**, independently of
 * the React Native JS thread:
 *
 *  - samples GPS every `POSITION_INTERVAL_SECONDS` (configurable by
 *    `SET_FREQUENCY`), buffers payloads in SQLite and flushes batches to
 *    `POST /api/tracking/events` (10 positions or 5 minutes, whichever first);
 *  - drains the high-priority panic queue first, then positions, retrying
 *    with exponential backoff (also re-triggered by WorkManager);
 *  - honors `SILENCE` / `REACTIVATE` without being restarted;
 *  - keeps running while the UI is closed (persistent notification).
 */
class CoreLogLocationService : Service() {

    private lateinit var storage: TrackingStorage
    private lateinit var config: TrackingConfigStore
    private lateinit var locationManager: LocationManager
    private val mainHandler = Handler(Looper.getMainLooper())

    private var backoffMs = INITIAL_BACKOFF_MS
    private var firstBufferedAtMs: Long = 0L

    /** Network I/O must stay off the main thread (Android blocks it). */
    private val drainExecutor = Executors.newSingleThreadExecutor()
    private var drainInFlight = false

    private val flushRunnable = Runnable {
        drainAndReschedule()
    }

    private val locationListener = LocationListener { location ->
        onNewLocation(location)
    }

    /** Receives `SET_FREQUENCY`/`SILENCE`/`REACTIVATE`/immediate-position commands. */
    private val commandReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.getStringExtra(EXTRA_COMMAND)) {
                CMD_INTERVAL ->
                    setIntervalSeconds(intent.getIntExtra(EXTRA_VALUE, config.intervalSeconds))
                CMD_SILENCE -> silence(intent.getIntExtra(EXTRA_VALUE, 60))
                CMD_REACTIVATE -> reactivate()
                CMD_IMMEDIATE -> requestImmediatePosition()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        storage = TrackingStorage(this)
        config = TrackingConfigStore(this)
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        runCatching {
            ContextCompat.registerReceiver(
                this,
                commandReceiver,
                IntentFilter(ACTION_COMMAND),
                ContextCompat.RECEIVER_NOT_EXPORTED
            )
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        isRunning = true
        config.trackingEnabled = true

        createNotificationChannel()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                buildNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(NOTIFICATION_ID, buildNotification())
        }

        startSampling(config.intervalSeconds)
        scheduleFlush()
        publishState()
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        runCatching { locationManager.removeUpdates(locationListener) }
        runCatching { unregisterReceiver(commandReceiver) }
        drainExecutor.shutdownNow()
        mainHandler.removeCallbacksAndMessages(null)
        publishState()
        super.onDestroy()
    }

    // -- sampling -------------------------------------------------------------

    private fun startSampling(intervalSeconds: Int) {
        runCatching { locationManager.removeUpdates(locationListener) }
        val intervalMs = (intervalSeconds.coerceAtLeast(5)) * 1000L
        val provider = bestProvider()
        if (provider == null) {
            // No provider yet: retry shortly, the watchdog keeps us alive.
            mainHandler.postDelayed({ startSampling(intervalSeconds) }, PROVIDER_RETRY_MS)
            return
        }
        runCatching {
            locationManager.requestLocationUpdates(provider, intervalMs, 0f, locationListener, Looper.getMainLooper())
        }
    }

    private fun bestProvider(): String? {
        val manager = locationManager
        return when {
            runCatching { manager.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false) ->
                LocationManager.GPS_PROVIDER
            runCatching { manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) }.getOrDefault(false) ->
                LocationManager.NETWORK_PROVIDER
            else -> null
        }
    }

    // -- buffering + flushing -------------------------------------------------

    private fun onNewLocation(location: Location) {
        if (config.isSilenced()) {
            return // SILENCE: keep sampling costs at zero until REACTIVATE
        }
        val payload = JSONObject().apply {
            put("vehicle_id", config.vehicleId)
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            put("timestamp_utc", TrackingConfigStore.isoUtc(location.time))
            if (location.hasSpeed()) {
                put("speed_kmh", (location.speed * 3.6f).toDouble())
            }
        }
        storage.appendPosition(payload.toString())

        config.lastKnownLatitude = location.latitude
        config.lastKnownLongitude = location.longitude
        config.lastKnownTimestampUtc = TrackingConfigStore.isoUtc(location.time)
        config.lastKnownSpeedKmh = if (location.hasSpeed()) location.speed * 3.6f else null

        if (firstBufferedAtMs == 0L) {
            firstBufferedAtMs = System.currentTimeMillis()
        }
        publishState()

        val batchReady = storage.countPositions() >= config.batchSize
        val fiveMinutesReady =
            firstBufferedAtMs > 0 && System.currentTimeMillis() - firstBufferedAtMs >= FLUSH_INTERVAL_MS
        if (batchReady || fiveMinutesReady) {
            drainAndReschedule()
        }
    }

    /**
     * Drains panics first (high priority), then one position batch, then
     * reschedules itself with exponential backoff while rows remain.
     */
    private fun drainAndReschedule() {
        if (config.baseUrl.isBlank()) {
            return
        }
        if (drainInFlight) {
            return // a drain is already running on the background thread
        }
        drainInFlight = true
        drainExecutor.execute {
            val progressed = drainQueues(storage, config)
            mainHandler.post {
                drainInFlight = false
                firstBufferedAtMs = if (storage.countPositions() > 0) firstBufferedAtMs else 0L
                if (progressed) {
                    backoffMs = INITIAL_BACKOFF_MS
                } else if (storage.countPositions() > 0 || storage.countPanics() > 0) {
                    backoffMs = (backoffMs * 2).coerceAtMost(MAX_BACKOFF_MS)
                }
                publishState()
                scheduleFlush()
            }
        }
    }

    private fun scheduleFlush() {
        mainHandler.removeCallbacks(flushRunnable)
        if (storage.countPositions() > 0 || storage.countPanics() > 0) {
            mainHandler.postDelayed(flushRunnable, backoffMs)
        }
    }

    // -- remote commands ------------------------------------------------------

    /** `SET_FREQUENCY` — restarts sampling with the new period. */
    fun setIntervalSeconds(seconds: Int) {
        config.intervalSeconds = seconds
        if (isRunning) {
            startSampling(seconds)
        }
        publishState()
    }

    /** `SILENCE` — stops buffering/sending for the given duration. */
    fun silence(durationSeconds: Int) {
        config.silencedUntilMs = System.currentTimeMillis() + durationSeconds * 1000L
        publishState()
    }

    /** `REACTIVATE` — clears an active silence window. */
    fun reactivate() {
        config.clearSilence()
        publishState()
    }

    /** `REQUEST_IMMEDIATE_POSITION` — one-shot fix + immediate upload. */
    fun requestImmediatePosition() {
        val provider = bestProvider() ?: return
        val deliver = { location: Location ->
            onNewLocation(location)
            drainAndReschedule()
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            locationManager.getCurrentLocation(provider, null, mainExecutor, deliver)
        } else {
            @Suppress("DEPRECATION")
            locationManager.getLastKnownLocation(provider)?.let(deliver)
        }
    }

    // -- state publishing -----------------------------------------------------

    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("CoreLog tracking")
            .setContentText("Vehicle ${config.vehicleId} — every ${config.intervalSeconds}s")
            .setOngoing(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "CoreLog tracking",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shown while background tracking is active"
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    companion object {

        private const val TAG = "CoreLogLocationService"
        const val ACTION_STATE_CHANGED = "com.corelog.mobile.STATE_CHANGED"
        private const val CHANNEL_ID = "corelog_tracking"
        private const val NOTIFICATION_ID = 4242
        private const val INITIAL_BACKOFF_MS = 5_000L
        private const val MAX_BACKOFF_MS = 300_000L
        private const val FLUSH_INTERVAL_MS = 5 * 60 * 1000L
        private const val PROVIDER_RETRY_MS = 10_000L

        /** Survives transient process deaths; cleared by the watchdog logic. */
        @Volatile
        var isRunning: Boolean = false

        /** Local broadcast action carrying a command to the running service. */
        const val ACTION_COMMAND = "com.corelog.mobile.background.COMMAND"
        const val EXTRA_COMMAND = "command"
        const val EXTRA_VALUE = "value"
        const val CMD_INTERVAL = "interval"
        const val CMD_SILENCE = "silence"
        const val CMD_REACTIVATE = "reactivate"
        const val CMD_IMMEDIATE = "immediate"

        /** Listeners notified after every state mutation (React module). */
        private val stateListeners = CopyOnWriteArrayList<() -> Unit>()

        fun addStateListener(listener: () -> Unit) {
            stateListeners.add(listener)
        }

        fun removeStateListener(listener: () -> Unit) {
            stateListeners.remove(listener)
        }

        fun publishState() {
            stateListeners.forEach { listener ->
                runCatching { listener() }
            }
        }

        /**
         * Drains the panic queue first and then one position batch.
         *
         * Shared with [CoreLogWorker] so WorkManager can flush while the
         * foreground service is not running (e.g. after connectivity returns).
         *
         * @return true when at least one row was delivered.
         */
        fun drainQueues(storage: TrackingStorage, config: TrackingConfigStore): Boolean {
            if (config.baseUrl.isBlank()) {
                return false
            }
            var progressed = false
            val positionCount = storage.countPositions()
            val panicCount = storage.countPanics()
            Log.d(TAG, "drain start: $positionCount position(s), $panicCount panic(s), batch=${config.batchSize}")

            // 1. High-priority panics.
            for (row in storage.takePanics(PANIC_DRAIN_LIMIT)) {
                if (CoreLogUploader.uploadPanic(config.baseUrl, row.payload)) {
                    storage.deletePanic(row.id)
                    progressed = true
                } else {
                    break // offline: keep the rest for the next attempt
                }
            }

            // 2. One position batch (BATCH_SIZE or whatever is buffered).
            val batch = storage.takePositions(config.batchSize)
            if (batch.isNotEmpty() &&
                CoreLogUploader.uploadPositionBatch(config.baseUrl, batch.map { it.payload })
            ) {
                storage.deletePositions(batch.map { it.id })
                config.lastSendAtUtc = TrackingConfigStore.isoUtc(System.currentTimeMillis())
                progressed = true
            }

            return progressed
        }

        private const val PANIC_DRAIN_LIMIT = 20
    }
}
