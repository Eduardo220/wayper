package com.wayper.app.run

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import java.util.Locale
import kotlin.math.max

class RunNotificationForegroundService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var baseElapsedSeconds = 0L
  private var distanceKm = 0.0
  private var isPaused = false
  private var baseElapsedRealtime = 0L
  private var foregroundStarted = false

  private val ticker = object : Runnable {
    override fun run() {
      updateVisibleNotification()
      if (!isPaused) {
        handler.postDelayed(this, TICK_INTERVAL_MS)
      }
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START, ACTION_UPDATE -> {
        applyIntentState(intent)
        startOrUpdateForeground()
        scheduleTicker()
        return START_STICKY
      }
      ACTION_STOP -> {
        stopNotificationService()
        return START_NOT_STICKY
      }
      else -> return START_NOT_STICKY
    }
  }

  override fun onDestroy() {
    handler.removeCallbacks(ticker)
    super.onDestroy()
  }

  private fun applyIntentState(intent: Intent) {
    baseElapsedSeconds = max(0L, intent.getLongExtra(EXTRA_ELAPSED_SECONDS, baseElapsedSeconds))
    distanceKm = max(0.0, intent.getDoubleExtra(EXTRA_DISTANCE_KM, distanceKm))
    isPaused = intent.getBooleanExtra(EXTRA_IS_PAUSED, isPaused)
    baseElapsedRealtime = SystemClock.elapsedRealtime()
  }

  private fun displayElapsedSeconds(): Long {
    if (isPaused) return baseElapsedSeconds
    val deltaSeconds = max(0L, (SystemClock.elapsedRealtime() - baseElapsedRealtime) / 1000L)
    return baseElapsedSeconds + deltaSeconds
  }

  private fun startOrUpdateForeground() {
    ensureChannel(this)
    val notification = buildNotification()
    if (!foregroundStarted) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      foregroundStarted = true
      return
    }

    updateVisibleNotification(notification)
  }

  private fun updateVisibleNotification(notification: Notification = buildNotification()) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    manager.notify(NOTIFICATION_ID, notification)
  }

  private fun scheduleTicker() {
    handler.removeCallbacks(ticker)
    if (!isPaused) {
      handler.postDelayed(ticker, TICK_INTERVAL_MS)
    }
  }

  private fun stopNotificationService() {
    handler.removeCallbacks(ticker)
    foregroundStarted = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  private fun buildNotification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    val buttonAction = if (isPaused) ACTION_RESUME else ACTION_PAUSE
    val buttonLabel = if (isPaused) "Iniciar" else "Parar"
    val buttonIntent = Intent(this, RunNotificationActionReceiver::class.java).apply {
      action = ACTION_BUTTON
      putExtra(EXTRA_BUTTON_ACTION, buttonAction)
    }
    val buttonPendingIntent = PendingIntent.getBroadcast(
      this,
      if (isPaused) REQUEST_RESUME else REQUEST_PAUSE,
      buttonIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentImmutableFlag()
    )

    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      action = Intent.ACTION_VIEW
      data = Uri.parse(ACTIVE_RUN_DEEP_LINK)
      putExtra(EXTRA_OPEN_ACTIVE_RUN, true)
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or
        Intent.FLAG_ACTIVITY_CLEAR_TOP or
        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
    }
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this,
        REQUEST_OPEN,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or pendingIntentImmutableFlag()
      )
    }

    builder
      .setContentTitle("Wayper")
      .setContentText(formatContentText())
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setCategory(Notification.CATEGORY_SERVICE)
      .addAction(applicationInfo.icon, buttonLabel, buttonPendingIntent)

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      @Suppress("DEPRECATION")
      builder.setPriority(Notification.PRIORITY_HIGH)
    }

    contentIntent?.let { builder.setContentIntent(it) }
    return builder.build()
  }

  private fun formatContentText(): String {
    val state = if (isPaused) "Corrida pausada" else "Corrida"
    val elapsed = formatElapsedTime(displayElapsedSeconds())
    val distance = String.format(PT_BR, "%.2f km", distanceKm)
    return "$state · $elapsed · ${distance.replace('.', ',')}"
  }

  private fun formatElapsedTime(seconds: Long): String {
    val total = max(0L, seconds)
    val hours = total / 3600L
    val minutes = (total % 3600L) / 60L
    val secs = total % 60L
    return if (hours > 0L) {
      String.format(Locale.US, "%d:%02d:%02d", hours, minutes, secs)
    } else {
      String.format(Locale.US, "%02d:%02d", minutes, secs)
    }
  }

  companion object {
    const val CHANNEL_ID = "wayper_run_tracking"
    const val NOTIFICATION_ID = 4217
    const val ACTION_START = "com.wayper.app.run.notification.START"
    const val ACTION_UPDATE = "com.wayper.app.run.notification.UPDATE"
    const val ACTION_STOP = "com.wayper.app.run.notification.STOP"
    const val ACTION_BUTTON = "com.wayper.app.run.notification.BUTTON"
    const val ACTION_OPEN_RUN = "com.wayper.app.run.notification.OPEN_RUN"
    const val ACTION_PAUSE = "pause"
    const val ACTION_RESUME = "resume"
    const val ACTIVE_RUN_DEEP_LINK = "wayper://run/active"
    const val EXTRA_ELAPSED_SECONDS = "elapsedTimeSeconds"
    const val EXTRA_DISTANCE_KM = "distanceKm"
    const val EXTRA_IS_PAUSED = "isPaused"
    const val EXTRA_BUTTON_ACTION = "runNotificationAction"
    const val EXTRA_OPEN_ACTIVE_RUN = "openActiveRun"

    private const val TICK_INTERVAL_MS = 1000L
    private const val REQUEST_OPEN = 42170
    private const val REQUEST_PAUSE = 42171
    private const val REQUEST_RESUME = 42172
    private val PT_BR = Locale("pt", "BR")

    fun start(context: Context, elapsedSeconds: Long, distanceKm: Double, isPaused: Boolean) {
      val intent = Intent(context, RunNotificationForegroundService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_ELAPSED_SECONDS, elapsedSeconds)
        putExtra(EXTRA_DISTANCE_KM, distanceKm)
        putExtra(EXTRA_IS_PAUSED, isPaused)
      }
      startForegroundServiceCompat(context, intent)
    }

    fun update(context: Context, elapsedSeconds: Long, distanceKm: Double, isPaused: Boolean) {
      val intent = Intent(context, RunNotificationForegroundService::class.java).apply {
        action = ACTION_UPDATE
        putExtra(EXTRA_ELAPSED_SECONDS, elapsedSeconds)
        putExtra(EXTRA_DISTANCE_KM, distanceKm)
        putExtra(EXTRA_IS_PAUSED, isPaused)
      }
      startForegroundServiceCompat(context, intent)
    }

    fun stop(context: Context) {
      val intent = Intent(context, RunNotificationForegroundService::class.java).apply {
        action = ACTION_STOP
      }
      context.startService(intent)
    }

    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
      val existing = manager.getNotificationChannel(CHANNEL_ID)
      if (existing != null) return

      val channel = NotificationChannel(
        CHANNEL_ID,
        "Wayper corrida",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Notificacao persistente da corrida ativa."
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      manager.createNotificationChannel(channel)
    }

    private fun startForegroundServiceCompat(context: Context, intent: Intent) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun pendingIntentImmutableFlag(): Int {
      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    }
  }
}
