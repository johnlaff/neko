package dev.johnlaff.neko.reminders

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.net.toUri
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import dev.johnlaff.neko.MainActivity
import dev.johnlaff.neko.NekoApp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.ApiException
import dev.johnlaff.neko.data.Reminder
import java.time.Duration
import java.time.ZonedDateTime

/** The two moments of the day, at the same hours as the site's push (worker/index.ts crons). */
enum class Slot(val hour: Int) { Morning(8), Evening(21) }

/** Pure timing, kept apart so it is tested without a phone. */
object ReminderClock {
    /** A reminder that waited this long (phone off, no network) is stale and stays quiet. */
    val LATE: Duration = Duration.ofHours(3)

    /** Time from [now] to the next [hour]:00 on the phone's clock, today or tomorrow. */
    fun untilNext(now: ZonedDateTime, hour: Int): Duration {
        var at = now.withHour(hour).withMinute(0).withSecond(0).withNano(0)
        if (!at.isAfter(now)) at = at.plusDays(1)
        return Duration.between(now, at)
    }

    /** Whether [now] is still close enough to today's [hour]:00 for the reminder to make sense. */
    fun onTime(now: ZonedDateTime, hour: Int): Boolean {
        val at = now.withHour(hour).withMinute(0).withSecond(0).withNano(0)
        return !now.isBefore(at.minusMinutes(15)) && now.isBefore(at.plus(LATE))
    }
}

/**
 * Reminders the phone shows by itself, read from GET /api/reminders when the time comes, so they
 * need no browser subscription and carry the numbers of that moment. Off until turned on in Ajustes.
 */
object Reminders {
    private const val PREFS = "reminders"
    private const val ON = "on"
    private const val CHANNEL = "reminders"

    fun enabled(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ON, false)

    fun setEnabled(context: Context, on: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit { putBoolean(ON, on) }
        if (on) Slot.entries.forEach { schedule(context, it, ExistingWorkPolicy.REPLACE) }
        else Slot.entries.forEach { WorkManager.getInstance(context).cancelUniqueWork(name(it)) }
    }

    /** At app start: puts back any slot that is missing (WorkManager already survives reboots). */
    fun ensure(context: Context) {
        if (enabled(context)) Slot.entries.forEach { schedule(context, it, ExistingWorkPolicy.KEEP) }
    }

    fun permitted(context: Context) =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    private fun name(slot: Slot) = "reminder-${slot.name.lowercase()}"

    internal fun schedule(context: Context, slot: Slot, policy: ExistingWorkPolicy) {
        val request = OneTimeWorkRequestBuilder<ReminderWorker>()
            .setInitialDelay(ReminderClock.untilNext(ZonedDateTime.now(), slot.hour))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf("slot" to slot.name))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(name(slot), policy, request)
    }

    internal fun show(context: Context, slot: Slot, r: Reminder) {
        if (!permitted(context)) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Lembretes", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Quanto cabe hoje, de manhã, e o lembrete de lançar o dia, à noite"
            },
        )
        // "/" is the app itself; anything else (today's row in the sheet) opens where it lives.
        val open = if (r.url.startsWith("http")) Intent(Intent.ACTION_VIEW, r.url.toUri())
        else Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val tap = PendingIntent.getActivity(
            context, slot.ordinal, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(r.title)
            .setContentText(r.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(r.body))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        // One per slot: tomorrow's morning replaces today's instead of stacking.
        try {
            NotificationManagerCompat.from(context).notify(slot.ordinal + 1, notification)
        } catch (e: SecurityException) {
            // Notifications were turned off between the check above and now.
        }
    }
}

class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val slot = Slot.valueOf(inputData.getString("slot") ?: return Result.success())
        if (!Reminders.enabled(applicationContext)) return Result.success()
        if (ReminderClock.onTime(ZonedDateTime.now(), slot.hour)) {
            try {
                val view = (applicationContext as NekoApp).api.reminders()
                (if (slot == Slot.Morning) view.morning else view.evening)
                    ?.let { Reminders.show(applicationContext, slot, it) }
            } catch (e: ApiException) {
                // Signed out or the sheet changed shape: nothing to say until that changes.
            } catch (e: Exception) {
                if (runAttemptCount < 3) return Result.retry()
            }
        }
        Reminders.schedule(applicationContext, slot, ExistingWorkPolicy.APPEND_OR_REPLACE)
        return Result.success()
    }
}
