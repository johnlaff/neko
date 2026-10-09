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
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.compose.ui.unit.DpSize
import androidx.glance.LocalSize
import androidx.glance.appwidget.SizeMode
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.width
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

/** One upcoming day on the tall widget: "Amanhã", "−R$ 1.900,00". */
data class WidgetDay(val label: String, val net: String, val income: Boolean)

/** What the widget says, decided apart from drawing so it can be tested. */
data class WidgetText(
    val caption: String,
    val figure: String,
    val footer: String,
    val alarm: Boolean,
    /** The open bill and, below it, the cycle's plan, for the wide widget; null without a card. */
    val bill: String? = null,
    val billDetail: String? = null,
    /** The next days with something on the sheet, for the tall widget. */
    val days: List<WidgetDay> = emptyList(),
    /** "Planilha em dia · 12 dias" and this week as seven marks, for the tall widget; null without a streak. */
    val streak: String? = null,
    val week: List<String> = emptyList(),
    /** What `bill` is: the open bill, or with the Diário previsto on, the month's spending. */
    val billLabel: String = "Fatura",
)

fun widgetText(v: TodayView?): WidgetText {
    val cs = v?.canSpend
    val days = v?.upcoming.orEmpty().take(3).map { d ->
        WidgetDay(Format.relativeDay(d.date, v!!.today), Format.signed(kotlin.math.abs(d.net), if (d.net > 0) '+' else '−'), d.net > 0)
    }
    val bill = cs?.let { Format.money(it.accumulated) }
    val h = v?.habit
    val streak = h?.let { dev.johnlaff.neko.ui.Learn.streakLabel(it.streak) }
    val week = h?.week.orEmpty().map { it.state }
    // With the Diário previsto on, the figure is the month's against the Diário, not a bill's.
    val month = cs?.mode == "month"
    val billDetail = cs?.let { "de ${Format.money(it.budget)} ${if (month) "previstos" else "do plano"}" }
    return when {
        v == null -> WidgetText("Neko", "Entrar", "Toque para abrir", false)
        cs == null -> WidgetText("Hoje", "Sem cartão", "Nenhuma fatura na planilha", false, days = days)
        cs.pace == "over" -> WidgetText("Passou do plano", Format.money(cs.overBy), if (month) "neste mês" else cs.card, true, bill, billDetail, days)
        else -> WidgetText(
            "Hoje cabem",
            Format.money(cs.perDay),
            when {
                cs.daysLeft > 1 -> "por dia · ${if (month) "até" else "fecha"} ${Format.shortDate(cs.closing)}"
                month -> "até o mês acabar, hoje"
                else -> "até a fatura fechar, hoje"
            },
            false,
            bill,
            billDetail,
            days,
        )
    }.copy(streak = streak, week = week, billLabel = if (month) "Gasto no mês" else "Fatura")
}

/** Invented numbers for the picker, never the owner's: anyone can browse widgets on the phone. */
val PREVIEW = WidgetText(
    "Hoje cabem", "R$ 148,00", "por dia · fecha 5 nov", false,
    "R$ 2.310,00", "de R$ 4.500,00 do plano",
    listOf(WidgetDay("Amanhã", "−R$ 120,00", false), WidgetDay("Sexta, 10 out", "+R$ 5.600,00", true)),
    "Planilha em dia · 5 dias",
    listOf("edited", "edited", "rest", "edited", "edited", "today", "future"),
)

private val SMALL = DpSize(110.dp, 50.dp)
private val WIDE = DpSize(250.dp, 50.dp)
private val TALL = DpSize(250.dp, 180.dp)

/**
 * Three shapes, as the home screen sizes it: the figure alone; the figure with the bill beside it;
 * and, taller, the next days below. Each answers at a glance, without opening the app.
 */
class TodayWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(SMALL, WIDE, TALL))
    override val previewSizeMode = SizeMode.Responsive(setOf(SMALL, WIDE, TALL))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val view = (context.applicationContext as NekoApp).today.cachedNow()
        provideContent { Content(widgetText(view)) }
    }

    /** The widget picker's picture (Android 15+): the real look with an invented figure. */
    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        provideContent { Content(PREVIEW) }
    }

    private fun pair(f: (dev.johnlaff.neko.ui.Ledger) -> Color) = ColorProvider(day = f(LightLedger), night = f(DarkLedger))

    @Composable
    internal fun Content(t: WidgetText) {
        val size = LocalSize.current
        val wide = size.width >= WIDE.width && t.bill != null
        val tall = size.width >= TALL.width && size.height >= TALL.height
        // One launcher row has no room for the line under the figure.
        val roomy = size.height >= 90.dp
        Column(
            GlanceModifier
                .fillMaxSize()
                // Marks the background so the launcher opens the app from the widget's shape.
                .appWidgetBackground()
                .background(pair { it.surface })
                .cornerRadius(20.dp)
                .padding(horizontal = 14.dp, vertical = 10.dp)
                .clickable(actionStartActivity<MainActivity>()),
            verticalAlignment = if (tall) Alignment.Top else Alignment.CenterVertically,
        ) {
            if (wide) {
                Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Figure(t, roomy, GlanceModifier.defaultWeight())
                    Column(GlanceModifier.defaultWeight()) {
                        Text(t.billLabel, style = TextStyle(color = pair { it.muted }, fontSize = 12.sp))
                        Text(t.bill ?: "", style = TextStyle(color = pair { it.text }, fontSize = 16.sp, fontWeight = FontWeight.Medium), maxLines = 1)
                        Text(t.billDetail ?: "", style = TextStyle(color = pair { it.faint }, fontSize = 11.sp), maxLines = 1)
                    }
                }
            } else {
                Figure(t, roomy)
            }
            if (tall && t.days.isNotEmpty()) {
                Spacer(GlanceModifier.height(10.dp))
                t.days.forEach { d ->
                    Row(GlanceModifier.fillMaxWidth().padding(vertical = 2.dp)) {
                        Text(d.label, style = TextStyle(color = pair { it.muted }, fontSize = 12.sp), maxLines = 1, modifier = GlanceModifier.defaultWeight())
                        Text(d.net, style = TextStyle(color = if (d.income) pair { it.pos } else pair { it.text }, fontSize = 12.sp), maxLines = 1)
                    }
                }
            }
            if (tall) {
                Spacer(GlanceModifier.defaultWeight())
                Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    t.week.forEach { s ->
                        // Filled when the sheet changed, hollow otherwise, ringed in jade for today.
                        Text(
                            if (s == "edited") "●" else "○",
                            style = TextStyle(
                                color = when (s) {
                                    "edited" -> pair { it.text }
                                    "today" -> pair { it.accent }
                                    else -> pair { it.faint }
                                },
                                fontSize = 11.sp,
                            ),
                            modifier = GlanceModifier.padding(end = 3.dp),
                        )
                    }
                    if (t.streak != null) {
                        Spacer(GlanceModifier.width(8.dp))
                        Text(t.streak, style = TextStyle(color = pair { it.muted }, fontSize = 12.sp), maxLines = 1)
                    }
                }
            }
        }
    }

    @Composable
    private fun Figure(t: WidgetText, roomy: Boolean, modifier: GlanceModifier = GlanceModifier) {
        Column(modifier) {
            Text(t.caption, style = TextStyle(color = pair { it.muted }, fontSize = 12.sp))
            Text(
                t.figure,
                style = TextStyle(
                    color = if (t.alarm) pair { it.neg } else pair { it.text },
                    // A one-cell-wide widget has room for "R$ 1.234,56" only a little smaller.
                    fontSize = if (LocalSize.current.width < WIDE.width) 20.sp else 24.sp,
                    fontWeight = FontWeight.Medium,
                ),
                maxLines = 1,
            )
            if (roomy) Text(t.footer, style = TextStyle(color = pair { it.faint }, fontSize = 11.sp), maxLines = 1)
        }
    }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}
