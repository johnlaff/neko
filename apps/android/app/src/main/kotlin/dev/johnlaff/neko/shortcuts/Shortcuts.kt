package dev.johnlaff.neko.shortcuts

import android.content.Context
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.core.net.toUri
import dev.johnlaff.neko.R
import dev.johnlaff.neko.ui.Tab

/** Where a launcher shortcut (res/xml/shortcuts.xml) or the widget takes the app. */
data class Launch(val tab: Tab, val simulate: Boolean = false, val queue: Boolean = false)

/** The widget's "N para lançar": Hoje, with Para lançar in view. */
const val PARA_LANCAR = "dev.johnlaff.neko.PARA_LANCAR"

fun launchFor(action: String?): Launch? = when (action) {
    "dev.johnlaff.neko.SIMULAR" -> Launch(Tab.Hoje, simulate = true)
    PARA_LANCAR -> Launch(Tab.Hoje, queue = true)
    "dev.johnlaff.neko.FATURAS" -> Launch(Tab.Faturas)
    "dev.johnlaff.neko.MES" -> Launch(Tab.Mes)
    else -> null
}

/** "Lançar", the one shortcut that changes: it opens today's row, which moves every day. */
object Shortcuts {
    private const val LANCAR = "lancar"

    fun lancar(context: Context, url: String?) {
        runCatching {
            if (url == null) {
                ShortcutManagerCompat.removeDynamicShortcuts(context, listOf(LANCAR))
                return
            }
            val shortcut = ShortcutInfoCompat.Builder(context, LANCAR)
                .setShortLabel(context.getString(R.string.shortcut_lancar))
                .setLongLabel(context.getString(R.string.shortcut_lancar_long))
                .setIcon(IconCompat.createWithResource(context, R.drawable.sc_glyph_lancar))
                .setIntent(Intent(Intent.ACTION_VIEW, url.toUri()))
                // First in the list: it is the daily habit the app exists for.
                .setRank(0)
                .build()
            ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
        }
    }
}
