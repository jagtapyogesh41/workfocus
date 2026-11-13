package com.shiftfocus.worker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class FocusMonitorService : Service() {

    companion object {
        private const val CHANNEL_ID = "shiftfocus_monitor"
        private const val NOTIF_ID = 1001

        fun start(ctx: Context) {
            val intent = Intent(ctx, FocusMonitorService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, FocusMonitorService::class.java))
        }
    }

    private var scheduler: ScheduledExecutorService? = null
    @Volatile
    private var lastBlockedLaunchMs = 0L

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        startForeground(NOTIF_ID, buildNotification("ShiftFocus active — syncing shift policy"))

        scheduler = Executors.newScheduledThreadPool(2).apply {
            scheduleWithFixedDelay({ syncPolicyFromServer() }, 0, 2, TimeUnit.SECONDS)
            scheduleWithFixedDelay({ checkForegroundApp() }, 400, 450, TimeUnit.MILLISECONDS)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        scheduler?.shutdownNow()
        scheduler = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun syncPolicyFromServer() {
        val token = ShiftFocusStore.getDeviceToken(this) ?: return
        val baseUrl = ShiftFocusStore.getServerUrl(this)
        runCatching {
            val state = ShiftFocusApi.fetchStatus(baseUrl, token)
            ShiftFocusStore.savePolicy(this, state)
            if (state.desiredMode != "focus" || state.overrideActive) {
                BlockOverlayController.dismiss(this)
            }
            val summary = when {
                state.overrideActive -> "Emergency Override active — all apps unlocked"
                state.desiredMode == "focus" -> "Focus Mode ON (${state.restrictedApps.size} apps paused)"
                else -> "Off shift / break — normal access"
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.notify(NOTIF_ID, buildNotification(summary))
        }.onFailure { err ->
            val nm = getSystemService(NotificationManager::class.java)
            nm.notify(NOTIF_ID, buildNotification("Sync warning: ${err.message?.take(40) ?: "retrying"}"))
        }
    }

    private fun checkForegroundApp() {
        val policy = ShiftFocusStore.getPolicy(this)
        if (policy.desiredMode != "focus" || policy.overrideActive) return

        val fgPkg = detectForegroundPackage() ?: return
        val blockedLabel = ShiftFocusStore.blockedLabelFor(this, fgPkg) ?: return

        val now = System.currentTimeMillis()
        if (now - lastBlockedLaunchMs < 900) return
        lastBlockedLaunchMs = now

        BlockOverlayController.show(this, blockedLabel, fgPkg)
    }

    private fun detectForegroundPackage(): String? {
        val usm = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return null
        val end = System.currentTimeMillis()
        val begin = end - 60_000
        val events = usm.queryEvents(begin, end)
        val event = UsageEvents.Event()
        var lastPkg: String? = null
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val pkg = event.packageName ?: continue
            if (pkg == packageName || pkg.startsWith("com.android.systemui")) continue
            if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED || event.eventType == 1) {
                lastPkg = pkg
            }
        }
        if (!lastPkg.isNullOrBlank()) return lastPkg

        val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, end - 120_000, end)
        return stats
            ?.filter { it.packageName != packageName && !it.packageName.startsWith("com.android.systemui") }
            ?.maxByOrNull { it.lastTimeUsed }
            ?.packageName
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "ShiftFocus Shift Monitor",
                NotificationManager.IMPORTANCE_LOW,
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
            .setContentTitle("ShiftFocus Worker")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(openIntent)
            .build()
    }
}
