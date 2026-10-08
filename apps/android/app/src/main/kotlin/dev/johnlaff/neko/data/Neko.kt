package dev.johnlaff.neko.data

import java.io.File
import java.util.concurrent.TimeUnit
import javax.crypto.SecretKey
import okhttp3.OkHttpClient

/**
 * Everything the app reads through, built once by NekoApp: the Worker's API, its cookies and the
 * screens' last readings. Tests build one around a local server and a temporary folder.
 */
class Neko(
    val api: Api,
    val cookies: CookieStore,
    val today: TodayRepository,
    val caches: Caches,
) {
    companion object {
        /** The app's wiring: every file sealed under [key] in [dir], every call to [baseUrl]. */
        fun create(dir: File, baseUrl: String, agent: String, key: Lazy<SecretKey?>): Neko {
            fun sealed(name: String) = SealedFile(File(dir, name), key)
            val cookies = CookieStore(sealed("cookies"))
            val client = OkHttpClient.Builder()
                .cookieJar(cookies)
                .callTimeout(30, TimeUnit.SECONDS)
                .addInterceptor { chain ->
                    chain.proceed(chain.request().newBuilder().header("User-Agent", agent).build())
                }
                .build()
            val api = Api(baseUrl, client, cookies)
            return Neko(
                api,
                cookies,
                TodayRepository(api, ViewCache(sealed("today.json"), TodayView.serializer())),
                Caches(
                    ViewCache(sealed("invoices.json"), InvoicesView.serializer()),
                    ViewCache(sealed("months.json"), MonthsView.serializer()),
                    ViewCache(sealed("ajustes.json"), AjustesView.serializer()),
                    ViewCache(sealed("history.json"), HistoryView.serializer()),
                ),
            )
        }
    }
}

/** What follows a new Hoje outside the app's screens: the widget and the "Lançar" shortcut. */
fun interface Effects {
    /** Null after signing out. */
    fun todayChanged(view: TodayView?)
}
