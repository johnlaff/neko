package dev.johnlaff.neko.purchases

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.edit
import androidx.glance.appwidget.updateAll
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import dev.johnlaff.neko.NekoApp
import dev.johnlaff.neko.data.ApiException
import dev.johnlaff.neko.data.BankNotice
import dev.johnlaff.neko.data.PhonePurchase
import dev.johnlaff.neko.reminders.Reminders
import dev.johnlaff.neko.ui.Format
import dev.johnlaff.neko.widget.TodayWidget
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.TimeUnit

/**
 * Avisos de compra (specs/002): with the owner's leave in Android's settings, the phone reads the
 * card purchase in a bank app's notice and sends the Worker its amount, shop and card digits, and
 * the words of that bank's notices of a purchase or a card, and of the phone wallets' notices of a
 * payment (PurchaseText.keep), kept 15 days. For
 * now this only learns: the Worker checks each read against what Open Finance brings, and the
 * ceiling moves with a bank app's reads only once that app is released by hand (worker/phone.ts
 * PHONE_RELEASED). Nothing of other apps' notices leaves the phone, and nothing is written to the
 * sheet.
 */
object Purchases {
    private const val PREFS = "purchases"
    private const val LAST = "last"
    private const val LAST_AT = "last_at"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Whether Android lets the Neko read notices: the only switch, kept in Android's settings. */
    fun granted(context: Context) = context.packageName in NotificationManagerCompat.getEnabledListenerPackages(context)

    /** Android's page for this one permission (all listeners below Android 11). */
    fun settings(context: Context): Intent {
        val component = ComponentName(context, PurchaseListener::class.java)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component.flattenToString())
        } else {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        }
    }

    /** The last purchase sent, for Ajustes to show what was read: "R$ 45,90 em Livraria". */
    fun last(context: Context): Pair<String, Long>? {
        val p = prefs(context)
        val text = p.getString(LAST, null) ?: return null
        return text to p.getLong(LAST_AT, 0)
    }

    internal fun remember(context: Context, text: String, at: Long) {
        prefs(context).edit {
            putString(LAST, text)
            putLong(LAST_AT, at)
        }
    }

    /** The same notice, posted again or updated, gets the same key. */
    fun key(sbnKey: String, amount: Long, at: Long): String = hash("$sbnKey|$amount|${at / 60_000}")

    /** A notice's words, kept once: posted again unchanged, the same key. */
    fun noticeKey(sbnKey: String, at: Long, text: String): String = hash("$sbnKey|${at / 60_000}|$text")

    private fun hash(s: String) =
        MessageDigest.getInstance("SHA-256")
            .digest(s.toByteArray())
            .joinToString("") { "%02x".format(it) }
            .take(40)

    internal fun keep(context: Context, notice: BankNotice) {
        val request = OneTimeWorkRequestBuilder<NoticeWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(
                workDataOf(
                    "id" to notice.id, "app" to notice.app, "bank" to notice.bank, "title" to notice.title,
                    "text" to notice.text, "at" to notice.at, "read" to notice.read,
                ),
            )
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("notice-${notice.id}", ExistingWorkPolicy.KEEP, request)
    }

    internal fun send(context: Context, purchase: PhonePurchase) {
        val request = OneTimeWorkRequestBuilder<PurchaseWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(
                workDataOf(
                    "id" to purchase.id, "bank" to purchase.bank, "amount" to purchase.amount,
                    "last4" to purchase.last4, "merchant" to purchase.merchant, "at" to purchase.at,
                ),
            )
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("purchase-${purchase.id}", ExistingWorkPolicy.KEEP, request)
    }
}

/** Android hands it every notice; only the bank apps' and the wallets' are looked at (PurchaseText). */
class PurchaseListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val source = PurchaseText.source(sbn.packageName) ?: return
        val n = sbn.notification
        // A group's summary repeats its notices; an ongoing one is no purchase.
        if (n.flags and (Notification.FLAG_GROUP_SUMMARY or Notification.FLAG_ONGOING_EVENT) != 0) return
        val extras = n.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()
        val read = PurchaseText.read(sbn.packageName, title, text)
        val at = n.`when`.takeIf { it > 0 } ?: sbn.postTime
        if (PurchaseText.keep(sbn.packageName, title, text)) {
            Purchases.keep(
                applicationContext,
                BankNotice(
                    id = Purchases.noticeKey(sbn.key, at, "$title|$text"),
                    app = sbn.packageName,
                    bank = source,
                    title = title.orEmpty().take(300),
                    text = text.orEmpty().take(2000),
                    at = Instant.ofEpochMilli(at).toString(),
                    read = read != null,
                ),
            )
        }
        if (read == null) return
        Purchases.send(
            applicationContext,
            PhonePurchase(
                id = Purchases.key(sbn.key, read.amount, at),
                bank = read.bank,
                amount = read.amount,
                last4 = read.last4,
                merchant = read.merchant,
                at = Instant.ofEpochMilli(at).toString(),
            ),
        )
    }
}

/**
 * Sends one purchase, then shows the messages it brought (the ceiling crossing a mark) and redraws
 * the widget with the ceiling's new room.
 */
class PurchaseWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val d = inputData
        val purchase = PhonePurchase(
            id = d.getString("id") ?: return Result.success(),
            bank = d.getString("bank") ?: return Result.success(),
            amount = d.getLong("amount", 0),
            last4 = d.getString("last4"),
            merchant = d.getString("merchant").orEmpty(),
            at = d.getString("at") ?: return Result.success(),
        )
        val app = applicationContext as NekoApp
        return try {
            val notices = app.api.purchase(purchase).notices
            Purchases.remember(applicationContext, said(purchase), Instant.parse(purchase.at).toEpochMilli())
            if (Reminders.enabled(applicationContext)) Reminders.showNotices(applicationContext, notices)
            runCatching {
                app.today.refresh()
                TodayWidget().updateAll(applicationContext)
            }
            Result.success()
        } catch (e: ApiException) {
            // Signed out, or a notice the Worker refused: sending it again changes nothing.
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 5) Result.retry() else Result.success()
        }
    }

    private fun said(p: PhonePurchase): String {
        val money = Format.money(p.amount)
        val shop = p.merchant.takeIf { it.isNotBlank() }?.let { Format.bankText(Format.merchantName(it)) }
        return if (shop != null) "$money em $shop" else "$money no ${p.bank}"
    }
}

/** Sends one notice's words; a refusal is final, a lost connection is tried again a few times. */
class NoticeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val d = inputData
        val notice = BankNotice(
            id = d.getString("id") ?: return Result.success(),
            app = d.getString("app") ?: return Result.success(),
            bank = d.getString("bank") ?: return Result.success(),
            title = d.getString("title").orEmpty(),
            text = d.getString("text").orEmpty(),
            at = d.getString("at") ?: return Result.success(),
            read = d.getBoolean("read", false),
        )
        return try {
            (applicationContext as NekoApp).api.notice(notice)
            Result.success()
        } catch (e: ApiException) {
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 5) Result.retry() else Result.success()
        }
    }
}
