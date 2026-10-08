package dev.johnlaff.neko.tile

import android.app.PendingIntent
import android.app.StatusBarManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.core.net.toUri
import dev.johnlaff.neko.MainActivity
import dev.johnlaff.neko.NekoApp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.ui.Learn

/** What the tile says, apart from Android so it can be tested: lit until the day is logged. */
data class TileText(val subtitle: String?, val active: Boolean)

fun tileText(v: TodayView?): TileText {
    val h = v?.habit ?: return TileText(null, true)
    return TileText(if (h.editedToday) "Hoje já lançado" else Learn.streakLabel(h.streak), !h.editedToday)
}

/**
 * "Lançar" in Quick Settings: one swipe down and a tap opens today's row in the sheet, from any
 * app. The habit the method asks for, as close to the thumb as Android allows.
 */
class LancarTile : TileService() {
    private fun view() = (application as NekoApp).today.cachedNow()

    override fun onStartListening() {
        val t = tileText(view())
        qsTile?.apply {
            label = getString(R.string.shortcut_lancar)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) subtitle = t.subtitle
            state = if (t.active) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            updateTile()
        }
    }

    // The PendingIntent form only exists from Android 14; older phones still need the Intent one.
    @android.annotation.SuppressLint("StartActivityAndCollapseDeprecated")
    override fun onClick() {
        val url = view()?.todayUrl
        val intent = (if (url != null) Intent(Intent.ACTION_VIEW, url.toUri()) else Intent(this, MainActivity::class.java))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }

    companion object {
        /** Android 13+ can offer the tile in a system dialog instead of the edit grid. */
        val canAsk: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

        fun ask(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
            context.getSystemService(StatusBarManager::class.java)?.requestAddTileService(
                ComponentName(context, LancarTile::class.java),
                context.getString(R.string.shortcut_lancar),
                Icon.createWithResource(context, R.drawable.ic_add),
                context.mainExecutor,
            ) {}
        }

        /** Asks Android to redraw the tile after a read changed the day's state. */
        fun refresh(context: Context) {
            runCatching { requestListeningState(context, ComponentName(context, LancarTile::class.java)) }
        }
    }
}
