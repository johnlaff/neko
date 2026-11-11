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
import dev.johnlaff.neko.data.Notice
import dev.johnlaff.neko.data.Reminder
import dev.johnlaff.neko.shortcuts.FATURAS
import dev.johnlaff.neko.shortcuts.PARA_LANCAR
import java.time.Duration
import java.time.ZonedDateTime

/** The two moments of the day: 08:00, and the evening hour chosen in Ajustes (worker/notices.ts). */
enum class Slot { Morning, Evening }

/** Pure timing, kept apart so it is tested without a phone. */
object ReminderClock {
    const val MORNING = 8
    const val EVENING = 21
    /** The evening hours Ajustes offers, as the Worker accepts them. */
    val EVENING_HOURS = 19..23

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

    /**
     * How long a message stays in the tray: the morning's until the evening one, the evening's until
     * the next morning. Its numbers are old by then, and nothing old waits there.
     */
    fun keep(now: ZonedDateTime, slot: Slot, eveningHour: Int): Duration =
        untilNext(now, if (slot == Slot.Morning) eveningHour else MORNING)
}

/**
 * Each kind of notification has its own Android channel, so one can be silenced without the
 * others, and what a tap on it counts as in Uso do Neko (shared/usage.ts NOTICE_TAP).
 */
enum class Kind(
    val channel: String,
    val title: String,
    val about: String,
    val tap: String,
    /** All the lock screen says: the amounts show once unlocked. */
    val locked: String,
) {
    Morning(
        "manha", "Contas e teto",
        "De manhã, só quando vence uma conta, o saldo fica negativo, é dia de guardar ou o teto passa de 75%. Aos domingos, a semana",
        "notificacao_manha", "Contas e teto",
    ),
    Evening(
        "noite", "Lançar o dia",
        "Na hora escolhida, o que espera em Para lançar, ou o lembrete de lançar o dia",
        "notificacao_noite", "Hora de lançar o dia",
    ),
    Alert(
        "avisos", "Avisos",
        "Quando o Neko não consegue ler a planilha ou os bancos",
        "notificacao_aviso", "Um aviso do Neko",
    ),
}

/**
 * Notifications the phone shows by itself, read from the Worker when the time comes, so they need
 * no push service and carry the numbers of that moment: GET /api/reminders at 08:00 and at the
 * evening hour, and the server's alerts also every 3 hours with the widget. Off until turned on.
 */
object Reminders {
    private const val PREFS = "reminders"
    private const val ON = "on"
    private const val HOUR = "evening_hour"
    private const val SHOWN = "notices_shown"
    /** The one channel before each kind had its own. */
    private const val OLD_CHANNEL = "reminders"
    /** Alerts' notification ids start here; the two messages use 1 and 2. */
    private const val NOTICE_IDS = 1000

    /** Says which notification opened the app, so Uso do Neko counts the tap. */
    const val TAP = "dev.johnlaff.neko.TAP"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(context: Context) = prefs(context).getBoolean(ON, false)

    fun setEnabled(context: Context, on: Boolean) {
        prefs(context).edit { putBoolean(ON, on) }
        if (on) Slot.entries.forEach { schedule(context, it, ExistingWorkPolicy.REPLACE) }
        else Slot.entries.forEach { WorkManager.getInstance(context).cancelUniqueWork(name(it)) }
    }

    fun eveningHour(context: Context) =
        prefs(context).getInt(HOUR, ReminderClock.EVENING).takeIf { it in ReminderClock.EVENING_HOURS }
            ?: ReminderClock.EVENING

    /** A new evening hour, picked here or on the site: the evening slot moves to it. */
    fun setEveningHour(context: Context, hour: Int) {
        if (hour !in ReminderClock.EVENING_HOURS || hour == eveningHour(context)) return
        prefs(context).edit { putInt(HOUR, hour) }
        if (enabled(context)) schedule(context, Slot.Evening, ExistingWorkPolicy.REPLACE)
    }

    private fun hourOf(context: Context, slot: Slot) =
        if (slot == Slot.Morning) ReminderClock.MORNING else eveningHour(context)

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
            .setInitialDelay(ReminderClock.untilNext(ZonedDateTime.now(), hourOf(context, slot)))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf("slot" to slot.name))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(name(slot), policy, request)
    }

    private fun channels(manager: NotificationManager) {
        manager.deleteNotificationChannel(OLD_CHANNEL)
        manager.createNotificationChannels(
            Kind.entries.map { k ->
                NotificationChannel(k.channel, k.title, NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = k.about
                }
            },
        )
    }

    /**
     * Where a tap lands: Para lançar and Faturas through the app's own shortcuts, Hoje for the
     * rest, and the sheet itself when the message points at today's row.
     */
    private fun tapFor(context: Context, url: String, kind: Kind, id: Int): PendingIntent {
        val open = if (url.startsWith("http")) Intent(Intent.ACTION_VIEW, url.toUri())
        else Intent(context, MainActivity::class.java)
            .setAction(
                when (url) {
                    "/#para-lancar" -> PARA_LANCAR
                    "/faturas" -> FATURAS
                    else -> Intent.ACTION_MAIN
                },
            )
            .putExtra(TAP, kind.tap)
            // The activity is singleTop: a running app takes the tap in onNewIntent.
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(
            context, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    /** Posts one notification; false when Android does not let the app show it. */
    private fun post(
        context: Context,
        kind: Kind,
        id: Int,
        title: String,
        body: String,
        url: String,
        keep: Duration?,
    ): Boolean {
        if (!permitted(context)) return false
        channels(context.getSystemService(NotificationManager::class.java))
        val notification = NotificationCompat.Builder(context, kind.channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(tapFor(context, url, kind, id))
            .setAutoCancel(true)
            .setCategory(if (kind == Kind.Alert) NotificationCompat.CATEGORY_ERROR else NotificationCompat.CATEGORY_REMINDER)
            .apply { keep?.let { setTimeoutAfter(it.toMillis()) } }
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                NotificationCompat.Builder(context, kind.channel)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle("Neko")
                    .setContentText(kind.locked)
                    .build(),
            )
            .build()
        return try {
            NotificationManagerCompat.from(context).notify(id, notification)
            true
        } catch (e: SecurityException) {
            // Notifications were turned off between the check above and now.
            false
        }
    }

    /** The morning or evening message: one each, tomorrow's replacing today's. */
    internal fun show(context: Context, slot: Slot, r: Reminder) {
        val kind = if (slot == Slot.Morning) Kind.Morning else Kind.Evening
        post(
            context, kind, slot.ordinal + 1, r.title, r.body, r.url,
            ReminderClock.keep(ZonedDateTime.now(), slot, eveningHour(context)),
        )
    }

    private fun noticeId(id: String) = NOTICE_IDS + Math.floorMod(id.hashCode(), 100_000)

    /**
     * The server's alerts still standing: each shown once, and taken down once the Worker no longer
     * lists it (the sheet read again, a new Meu Pluggy sign-in).
     */
    fun showNotices(context: Context, notices: List<Notice>) {
        val shown = prefs(context).getStringSet(SHOWN, emptySet()).orEmpty()
        val standing = notices.map { it.id }.toSet()
        val posted = notices.filter { it.id !in shown }
            .filter { n -> post(context, Kind.Alert, noticeId(n.id), n.title, n.body, n.url, null) }
            .map { it.id }
        val manager = NotificationManagerCompat.from(context)
        (shown - standing).forEach { manager.cancel(noticeId(it)) }
        prefs(context).edit { putStringSet(SHOWN, (shown intersect standing) + posted) }
    }
}

class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val slot = Slot.valueOf(inputData.getString("slot") ?: return Result.success())
        val context = applicationContext
        if (!Reminders.enabled(context)) return Result.success()
        val hour = if (slot == Slot.Morning) ReminderClock.MORNING else Reminders.eveningHour(context)
        if (ReminderClock.onTime(ZonedDateTime.now(), hour)) {
            try {
                val view = (context as NekoApp).api.reminders(if (slot == Slot.Morning) "morning" else "evening")
                (if (slot == Slot.Morning) view.morning else view.evening)
                    ?.let { Reminders.show(context, slot, it) }
                Reminders.showNotices(context, view.notices)
                // An hour changed on the site moves the evening slot here too.
                Reminders.setEveningHour(context, view.eveningHour)
            } catch (e: ApiException) {
                // Signed out or the sheet changed shape: nothing to say until that changes.
            } catch (e: Exception) {
                if (runAttemptCount < 3) return Result.retry()
            }
        }
        Reminders.schedule(context, slot, ExistingWorkPolicy.APPEND_OR_REPLACE)
        return Result.success()
    }
}
