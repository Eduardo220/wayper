package com.wayper.app.run

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService

class RunNotificationActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.getStringExtra(RunNotificationForegroundService.EXTRA_BUTTON_ACTION)
      ?: return

    RunNotificationActionService.start(context, action)
    HeadlessJsTaskService.acquireWakeLockNow(context)
  }
}
