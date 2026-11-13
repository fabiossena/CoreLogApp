package com.corelog.mobile.background

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import org.json.JSONObject

/**
 * `NativeModules.CoreLogBackgroundService` — the JavaScript façade consumed
 * by `BackgroundServiceBridge`.
 *
 * Remote-command configuration is persisted in [TrackingConfigStore] and, when
 * the foreground service is alive, pushed to it through a local broadcast, so
 * commands work whether the service is running or not.
 *
 * State changes are pushed to JS as the `CoreLogBackgroundService.state`
 * event (both from this module and from the running service).
 */
class CoreLogBackgroundServiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val config = TrackingConfigStore(reactContext)
    private val storage = TrackingStorage(reactContext)

    private val stateListener: () -> Unit = {
        emitState()
    }

    override fun getName(): String = NAME

    override fun initialize() {
        super.initialize()
        CoreLogLocationService.addStateListener(stateListener)
    }

    override fun invalidate() {
        CoreLogLocationService.removeStateListener(stateListener)
        super.invalidate()
    }

    // -- lifecycle ------------------------------------------------------------

    @ReactMethod
    fun start(configMap: ReadableMap, promise: Promise) {
        try {
            configMap.getString("coreLogBaseUrl")?.let { config.baseUrl = it }
            configMap.getString("vehicleId")?.let { config.vehicleId = it }
            configMap.getInt("batchSize").takeIf { it > 0 }?.let { config.batchSize = it }
            configMap.getInt("positionIntervalSeconds")
                .takeIf { it > 0 }
                ?.let { config.intervalSeconds = it }
            config.trackingEnabled = true

            val intent = Intent(reactContext, CoreLogLocationService::class.java)
            ContextCompat.startForegroundService(reactContext, intent)
            CoreLogWorker.scheduleDrain(reactContext)
            emitState()
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("E_START", error.message, error)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            config.trackingEnabled = false
            reactContext.stopService(Intent(reactContext, CoreLogLocationService::class.java))
            CoreLogLocationService.isRunning = false
            emitState()
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("E_STOP", error.message, error)
        }
    }

    @ReactMethod
    fun getState(promise: Promise) {
        promise.resolve(buildStateMap())
    }

    // -- remote commands ------------------------------------------------------

    @ReactMethod
    fun setPositionInterval(seconds: Double, promise: Promise) {
        val value = seconds.toInt().coerceIn(5, 3600)
        config.intervalSeconds = value
        sendServiceCommand(CoreLogLocationService.CMD_INTERVAL, value)
        emitState()
        promise.resolve(null)
    }

    @ReactMethod
    fun silence(durationSeconds: Double, promise: Promise) {
        val value = durationSeconds.toInt().coerceAtLeast(1)
        config.silencedUntilMs = System.currentTimeMillis() + value * 1000L
        sendServiceCommand(CoreLogLocationService.CMD_SILENCE, value)
        emitState()
        promise.resolve(null)
    }

    @ReactMethod
    fun reactivate(promise: Promise) {
        config.clearSilence()
        sendServiceCommand(CoreLogLocationService.CMD_REACTIVATE, 0)
        emitState()
        promise.resolve(null)
    }

    @ReactMethod
    fun requestImmediatePosition(promise: Promise) {
        sendServiceCommand(CoreLogLocationService.CMD_IMMEDIATE, 0)
        // With no service running, the WorkManager drain still flushes whatever
        // is buffered; the next start() re-samples immediately.
        if (!CoreLogLocationService.isRunning) {
            CoreLogWorker.scheduleDrain(reactContext)
        }
        emitState()
        promise.resolve(null)
    }

    // -- panic + position accessors ------------------------------------------

    @ReactMethod
    fun enqueuePanic(payload: ReadableMap, promise: Promise) {
        try {
            storage.appendPanic(jsonFromReadable(payload).toString())
            // High-priority drain: works even with tracking OFF / UI closed.
            CoreLogWorker.scheduleDrain(reactContext)
            emitState()
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("E_PANIC_QUEUE", error.message, error)
        }
    }

    @ReactMethod
    fun getLastKnownPosition(promise: Promise) {
        val latitude = config.lastKnownLatitude
        val longitude = config.lastKnownLongitude
        val timestamp = config.lastKnownTimestampUtc
        if (latitude == null || longitude == null || timestamp == null) {
            promise.resolve(null)
            return
        }
        val map = Arguments.createMap().apply {
            putDouble("latitude", latitude)
            putDouble("longitude", longitude)
            putString("timestamp_utc", timestamp)
            config.lastKnownSpeedKmh
                ?.takeIf { it >= 0 }
                ?.let { putDouble("speed_kmh", it.toDouble()) }
        }
        promise.resolve(map)
    }

    // -- event plumbing -------------------------------------------------------

    @ReactMethod
    fun addListener(eventName: String) {
        // Required by `NativeEventEmitter`; state listeners live in initialize().
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // Required by `NativeEventEmitter`.
    }

    private fun sendServiceCommand(command: String, value: Int) {
        val intent = Intent(CoreLogLocationService.ACTION_COMMAND).apply {
            putExtra(CoreLogLocationService.EXTRA_COMMAND, command)
            putExtra(CoreLogLocationService.EXTRA_VALUE, value)
            setPackage(reactContext.packageName)
        }
        reactContext.sendBroadcast(intent)
    }

    private fun buildStateMap(): WritableMap = Arguments.createMap().apply {
        putBoolean("trackingEnabled", config.trackingEnabled)
        putString("lastSendAtUtc", config.lastSendAtUtc)
        putInt("pendingCount", storage.countPositions() + storage.countPanics())
        val silenced = config.silencedUntilMs.takeIf { it > System.currentTimeMillis() }
        putString("silencedUntilUtc", silenced?.let { TrackingConfigStore.isoUtc(it) })
        putInt("intervalSeconds", config.intervalSeconds)
    }

    private fun emitState() {
        if (reactContext.hasActiveReactInstance()) {
            reactContext.emitDeviceEvent(EVENT_STATE, buildStateMap())
        }
    }

    private fun jsonFromReadable(map: ReadableMap): JSONObject {
        val json = JSONObject()
        val iterator = map.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            when (map.getType(key)) {
                ReadableType.Number -> json.put(key, map.getDouble(key))
                ReadableType.String -> json.put(key, map.getString(key))
                ReadableType.Boolean -> json.put(key, map.getBoolean(key))
                ReadableType.Map -> {
                    val child = map.getMap(key)
                    if (child != null) {
                        json.put(key, jsonFromReadable(child))
                    }
                }
                ReadableType.Null -> json.put(key, JSONObject.NULL)
                else -> Unit
            }
        }
        return json
    }

    companion object {
        const val NAME = "CoreLogBackgroundService"
        const val EVENT_STATE = "CoreLogBackgroundService.state"
    }
}
