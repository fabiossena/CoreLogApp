package com.corelog.mobile.background

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.work.BackoffPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * WorkManager jobs that keep the tracking pipeline alive:
 *
 *  - **periodic watchdog** (every 15 min, exponential backoff): checks that
 *    the foreground service is still running and restarts it when the system
 *    killed it while `tracking_enabled` is set (best effort — the service
 *    itself is `START_STICKY`, this is a second line of defense);
 *  - **one-time drain**: scheduled by the React module after a panic is
 *    enqueued (and after connectivity restores) so queued panics/positions
 *    are uploaded even when the UI and the foreground service are closed.
 */
class CoreLogWorker(appContext: Context, params: WorkerParameters) :
    Worker(appContext, params) {

    override fun doWork(): Result {
        val context = applicationContext
        val config = TrackingConfigStore(context)
        val storage = TrackingStorage(context)

        // 1. Best-effort drain of the offline queues (panics first, natively).
        runCatching {
            CoreLogLocationService.drainQueues(storage, config)
        }

        // 2. Keep the foreground service alive while the user wants tracking.
        if (config.trackingEnabled && !CoreLogLocationService.isRunning) {
            runCatching {
                val intent = Intent(context, CoreLogLocationService::class.java)
                ContextCompat.startForegroundService(context, intent)
            }
        }
        return Result.success()
    }

    companion object {
        private const val WATCHDOG_WORK = "corelog-service-watchdog"
        private const val DRAIN_WORK = "corelog-queue-drain"

        /** Enqueues the periodic service watchdog (idempotent, called on app start). */
        fun enqueueWatchdog(context: Context) {
            val request = PeriodicWorkRequestBuilder<CoreLogWorker>(15, TimeUnit.MINUTES)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WATCHDOG_WORK,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }

        /**
         * Schedules an immediate drain with exponential backoff — used after a
         * panic is enqueued from JavaScript or when connectivity returns.
         */
        fun scheduleDrain(context: Context) {
            val request = OneTimeWorkRequestBuilder<CoreLogWorker>()
                .setInitialDelay(10, TimeUnit.SECONDS)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                DRAIN_WORK,
                ExistingWorkPolicy.REPLACE,
                request
            )
        }
    }
}
