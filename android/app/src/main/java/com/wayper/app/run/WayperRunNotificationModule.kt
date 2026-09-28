package com.wayper.app.run

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import kotlin.math.max

class WayperRunNotificationModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "WayperRunNotificationAndroid"

  @ReactMethod
  fun configureRunNotificationActions(options: ReadableMap?, promise: Promise) {
    try {
      RunNotificationForegroundService.ensureChannel(reactContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("RUN_NOTIFICATION_CONFIGURE_FAILED", error)
    }
  }

  @ReactMethod
  fun startRunNotification(options: ReadableMap, promise: Promise) {
    try {
      RunNotificationForegroundService.start(
        reactContext,
        elapsedSeconds(options),
        distanceKm(options),
        isPaused(options),
        statusLabel(options),
        actionLabel(options)
      )
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("RUN_NOTIFICATION_START_FAILED", error)
    }
  }

  @ReactMethod
  fun updateRunNotification(options: ReadableMap, promise: Promise) {
    try {
      RunNotificationForegroundService.update(
        reactContext,
        elapsedSeconds(options),
        distanceKm(options),
        isPaused(options),
        statusLabel(options),
        actionLabel(options)
      )
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("RUN_NOTIFICATION_UPDATE_FAILED", error)
    }
  }

  @ReactMethod
  fun stopRunNotification(options: ReadableMap?, promise: Promise) {
    try {
      RunNotificationForegroundService.stop(reactContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("RUN_NOTIFICATION_STOP_FAILED", error)
    }
  }

  @ReactMethod
  fun isActive(promise: Promise) {
    try {
      promise.resolve(RunNotificationForegroundService.isActive())
    } catch (error: Exception) {
      promise.reject("RUN_NOTIFICATION_STATE_FAILED", error)
    }
  }

  @ReactMethod
  fun getState(promise: Promise) {
    try {
      promise.resolve(toWritableMap(RunNotificationForegroundService.getLastState()))
    } catch (error: Exception) {
      promise.reject("RUN_NOTIFICATION_STATE_FAILED", error)
    }
  }

  @ReactMethod
  fun getLastNotificationState(promise: Promise) {
    getState(promise)
  }

  private fun elapsedSeconds(options: ReadableMap): Long {
    val value = when {
      options.hasKey("elapsedTimeSeconds") -> options.getDouble("elapsedTimeSeconds")
      options.hasKey("elapsedTime") -> options.getDouble("elapsedTime")
      options.hasKey("durationSeconds") -> options.getDouble("durationSeconds")
      else -> 0.0
    }
    return max(0L, value.toLong())
  }

  private fun distanceKm(options: ReadableMap): Double {
    val value = when {
      options.hasKey("distanceKm") -> options.getDouble("distanceKm")
      options.hasKey("distanceMeters") -> options.getDouble("distanceMeters") / 1000.0
      options.hasKey("distance") -> options.getDouble("distance") / 1000.0
      else -> 0.0
    }
    return max(0.0, value)
  }

  private fun isPaused(options: ReadableMap): Boolean {
    return options.hasKey("isPaused") && options.getBoolean("isPaused")
  }

  private fun statusLabel(options: ReadableMap): String? {
    return if (options.hasKey("statusLabel") && !options.isNull("statusLabel")) {
      options.getString("statusLabel")
    } else {
      null
    }
  }

  private fun actionLabel(options: ReadableMap): String? {
    return if (options.hasKey("actionLabel") && !options.isNull("actionLabel")) {
      options.getString("actionLabel")
    } else {
      null
    }
  }

  private fun toWritableMap(source: Map<String, Any?>): WritableMap {
    val map = Arguments.createMap()
    source.forEach { (key, value) ->
      when (value) {
        null -> map.putNull(key)
        is Boolean -> map.putBoolean(key, value)
        is Int -> map.putInt(key, value)
        is Long -> map.putDouble(key, value.toDouble())
        is Float -> map.putDouble(key, value.toDouble())
        is Double -> map.putDouble(key, value)
        else -> map.putString(key, value.toString())
      }
    }
    return map
  }
}
