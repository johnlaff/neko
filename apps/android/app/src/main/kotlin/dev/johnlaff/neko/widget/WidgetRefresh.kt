package dev.johnlaff.neko.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dev.johnlaff.neko.NekoApp
import dev.johnlaff.neko.data.ApiException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Reads Hoje every few hours with the network on, so the widget follows the day (and a new
 * purchase on the sheet) without opening the app. The Worker caches per sheet version, so an
 * unchanged sheet costs one Drive call.
 */
class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as NekoApp
        return try {
            app.today.refresh()
            TodayWidget().updateAll(applicationContext)
            Result.success()
        } catch (e: ApiException) {
            // Signed out or the sheet changed shape: retrying will not help until something changes.
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}

object WidgetRefresh {
    private const val NAME = "today-refresh"

    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<RefreshWorker>(3, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** Redraws the widget from the cache after the app read the sheet or signed out. */
    fun redraw(context: Context) {
        CoroutineScope(Dispatchers.Default).launch { TodayWidget().updateAll(context) }
    }
}
