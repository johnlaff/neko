package dev.johnlaff.neko

import android.app.Application
import android.os.Build
import android.os.StrictMode
import dev.johnlaff.neko.data.Neko
import dev.johnlaff.neko.data.SealedFile
import dev.johnlaff.neko.reminders.Reminders
import dev.johnlaff.neko.security.LockClock
import dev.johnlaff.neko.widget.WidgetRefresh

/** Holds the app's one Neko (API, cookies, last readings) for the activity, widget and workers. */
class NekoApp : Application() {
    lateinit var neko: Neko
        private set
    val api get() = neko.api
    val today get() = neko.today
    /** Lives with the process: a fresh start of the app always asks, a rotation never does. */
    val lock = LockClock()

    override fun onCreate() {
        super.onCreate()
        // Debug builds flag disk and network work on the main thread, where it would stutter.
        if (BuildConfig.DEBUG) {
            StrictMode.setThreadPolicy(
                StrictMode.ThreadPolicy.Builder().detectDiskReads().detectDiskWrites().detectNetwork().penaltyLog().build(),
            )
        }
        // "Android" in the user agent names this device in the site's Ajustes; "NekoApp" tells
        // it apart from the browser on the same phone.
        val agent = "NekoApp/${BuildConfig.VERSION_NAME} (Linux; Android ${Build.VERSION.RELEASE}; ${Build.MODEL})"
        neko = Neko.create(noBackupFilesDir, BuildConfig.NEKO_URL, agent, lazy { SealedFile.keystoreKey() })
        WidgetRefresh.schedule(this)
        WidgetRefresh.publishPreview(this)
        Reminders.ensure(this)
    }
}
