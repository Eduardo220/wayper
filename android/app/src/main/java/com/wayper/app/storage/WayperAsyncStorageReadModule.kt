package com.wayper.app.storage

import android.database.sqlite.SQLiteDatabase
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class WayperAsyncStorageReadModule(
  private val context: ReactApplicationContext
) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "WayperAsyncStorageRead"

  @ReactMethod
  fun readOversizedRuns(promise: Promise) {
    try {
      for ((databaseName, table) in listOf("RKStorage" to "catalystLocalStorage", "AsyncStorage" to "Storage")) {
        val file = context.getDatabasePath(databaseName)
        if (!file.exists()) continue
        SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
          val length = database.rawQuery("SELECT length(value) FROM `$table` WHERE key = ?", arrayOf("runs")).use { cursor ->
            if (cursor.moveToFirst()) cursor.getInt(0) else null
          } ?: return@use
          require(length in 0..64_000_000) { "runs row exceeds safe migration size" }
          val value = StringBuilder(length)
          var offset = 1
          while (offset <= length) {
            val slice = database.rawQuery(
              "SELECT substr(value, ?, ?) FROM `$table` WHERE key = ?",
              arrayOf(offset.toString(), "64000", "runs")
            ).use { cursor ->
              if (cursor.moveToFirst()) cursor.getString(0) else null
            } ?: error("runs row changed during migration")
            value.append(slice)
            offset += 64_000
          }
          promise.resolve(value.toString())
          return
        }
      }
      promise.reject("RUNS_ROW_NOT_FOUND", "runs row was not found")
    } catch (error: Exception) {
      promise.reject("RUNS_ROW_READ_FAILED", error)
    }
  }
}
