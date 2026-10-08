package dev.johnlaff.neko.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import dev.johnlaff.neko.MainActivity
import dev.johnlaff.neko.NekoApp
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.ui.DarkLedger
import dev.johnlaff.neko.ui.Format
import dev.johnlaff.neko.ui.LightLedger

/** What the widget says, decided apart from drawing so it can be tested. */
data class WidgetText(val caption: String, val figure: String, val footer: String, val alarm: Boolean)

fun widgetText(v: TodayView?): WidgetText {
    val cs = v?.canSpend
    return when {
        v == null -> WidgetText("Neko", "Entrar", "Toque para abrir", false)
        cs == null -> WidgetText("Hoje", "Sem cartão", "Nenhuma fatura na planilha", false)
        cs.pace == "over" -> WidgetText("Passou do plano", Format.money(cs.overBy), cs.card, true)
        else -> WidgetText(
            "Hoje cabem",
            Format.money(cs.perDay),
            if (cs.daysLeft > 1) "por dia · fecha ${Format.shortDate(cs.closing)}" else "até a fatura fechar, hoje",
            false,
        )
    }
}

/** Invented numbers for the picker, never the owner's: anyone can browse widgets on the phone. */
val PREVIEW = WidgetText("Hoje cabem", "R$ 148,00", "por dia · fecha 5 nov", false)

class TodayWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val view = (context.applicationContext as NekoApp).today.cached()
        provideContent { Content(widgetText(view)) }
    }

    /** The widget picker's picture (Android 15+): the real look with an invented figure. */
    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        provideContent { Content(PREVIEW) }
    }

    @Composable
    private fun Content(t: WidgetText) {
        fun pair(f: (dev.johnlaff.neko.ui.Ledger) -> Color) = ColorProvider(day = f(LightLedger), night = f(DarkLedger))
        Column(
            GlanceModifier
                .fillMaxSize()
                .background(pair { it.surface })
                .cornerRadius(20.dp)
                .padding(horizontal = 14.dp, vertical = 10.dp)
                .clickable(actionStartActivity<MainActivity>()),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(t.caption, style = TextStyle(color = pair { it.muted }, fontSize = 12.sp))
            Text(
                t.figure,
                style = TextStyle(
                    color = if (t.alarm) pair { it.neg } else pair { it.text },
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Medium,
                ),
                maxLines = 1,
            )
            Text(t.footer, style = TextStyle(color = pair { it.faint }, fontSize = 11.sp), maxLines = 1)
        }
    }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}
