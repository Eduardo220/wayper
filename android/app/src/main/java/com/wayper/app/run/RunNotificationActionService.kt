package com.wayper.app.run

import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class RunNotificationActionService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val action = intent?.getStringExtra(RunNotificationForegroundService.EXTRA_BUTTON_ACTION)
      ?: return null
    val data = Arguments.createMap().apply {
      putString("action", action)
      putDouble("timestamp", System.currentTimeMillis().toDouble())
    }

    return HeadlessJsTaskConfig(
      TASK_NAME,
      data,
      TASK_TIMEOUT_MS,
      true
    )
  }

  companion object {
    const val TASK_NAME = "WayperRunNotificationAction"
    private const val TASK_TIMEOUT_MS = 15000L

    fun start(context: Context, action: String) {
      val intent = Intent(context, RunNotificationActionService::class.java).apply {
        putExtra(RunNotificationForegroundService.EXTRA_BUTTON_ACTION, action)
      }
      context.startService(intent)
    }
  }
}
