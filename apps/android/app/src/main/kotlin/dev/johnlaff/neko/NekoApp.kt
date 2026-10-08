package dev.johnlaff.neko

import android.app.Application
import android.os.Build
import android.os.StrictMode
import dev.johnlaff.neko.data.Api
import dev.johnlaff.neko.data.CookieStore
import dev.johnlaff.neko.data.AjustesView
import dev.johnlaff.neko.data.Caches
import dev.johnlaff.neko.data.HistoryView
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.data.MonthsView
import dev.johnlaff.neko.data.SealedFile
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.data.ViewCache
import dev.johnlaff.neko.data.TodayRepository
import dev.johnlaff.neko.reminders.Reminders
import dev.johnlaff.neko.security.LockClock
import dev.johnlaff.neko.widget.WidgetRefresh
import java.io.File
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

/** Holds the one API client, its cookies and the Hoje cache for the activity, widget and worker. */
class NekoApp : Application() {
    lateinit var cookies: CookieStore
        private set
    lateinit var api: Api
        private set
    lateinit var today: TodayRepository
        private set
    lateinit var caches: Caches
        private set
    /** Lives with the process: a fresh start of the app always asks, a rotation never does. */
    val lock = LockClock()

    override fun onCreate() {
        super.onCreate()
        // Debug builds flag disk and network work on the main thread, where it would stutter.
        if (BuildConfig.DEBUG) {
            StrictMode.setThreadPolicy(StrictMode.ThreadPolicy.Builder().detectDiskReads().detectDiskWrites().detectNetwork().penaltyLog().build())
        }
        val key = lazy { SealedFile.keystoreKey() }
        fun sealed(name: String) = SealedFile(File(noBackupFilesDir, name), key)
        cookies = CookieStore(sealed("cookies"))
        // "Android" in the user agent names this device in the site's Ajustes; "NekoApp" tells
        // it apart from the browser on the same phone.
        val agent = "NekoApp/${BuildConfig.VERSION_NAME} (Linux; Android ${Build.VERSION.RELEASE}; ${Build.MODEL})"
        val client = OkHttpClient.Builder()
            .cookieJar(cookies)
            .callTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                chain.proceed(chain.request().newBuilder().header("User-Agent", agent).build())
            }
            .build()
        api = Api(BuildConfig.NEKO_URL, client, cookies)
        today = TodayRepository(api, ViewCache(sealed("today.json"), TodayView.serializer()))
        caches = Caches(
            ViewCache(sealed("invoices.json"), InvoicesView.serializer()),
            ViewCache(sealed("months.json"), MonthsView.serializer()),
            ViewCache(sealed("ajustes.json"), AjustesView.serializer()),
            ViewCache(sealed("history.json"), HistoryView.serializer()),
        )
        WidgetRefresh.schedule(this)
        WidgetRefresh.publishPreview(this)
        Reminders.ensure(this)
    }
}
