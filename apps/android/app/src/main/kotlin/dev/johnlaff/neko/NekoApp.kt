package dev.johnlaff.neko

import android.app.Application
import android.os.Build
import dev.johnlaff.neko.data.Api
import dev.johnlaff.neko.data.CookieStore
import dev.johnlaff.neko.data.TodayRepository
import dev.johnlaff.neko.reminders.Reminders
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

    override fun onCreate() {
        super.onCreate()
        cookies = CookieStore(File(noBackupFilesDir, "cookies"))
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
        today = TodayRepository(api, File(noBackupFilesDir, "today.json"))
        WidgetRefresh.schedule(this)
        Reminders.ensure(this)
    }
}
