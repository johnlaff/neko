package dev.johnlaff.neko.ui

import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.Installment
import dev.johnlaff.neko.data.HistoryView
import dev.johnlaff.neko.data.MonthItem
import dev.johnlaff.neko.data.MonthsView
import dev.johnlaff.neko.data.Outflow
import dev.johnlaff.neko.data.Reserve
import dev.johnlaff.neko.data.TrendPoint
import dev.johnlaff.neko.data.YearTotals
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.monthName
import dev.johnlaff.neko.ui.Format.shortDate
import dev.johnlaff.neko.ui.Format.signed

/** A request to open Mês on a month, from a warning on Hoje; each tap is a new one, even for the same month. */
class MonthAsk(val key: String?)

/** Lines shown before "Ver mais", as on the site. */
private const val OUTFLOWS_SHOWN = 5

/** The site's Mês (web/screens/Mes.tsx): how a month ends, where the money went, what is fixed. */
@Composable
fun MesScreen(
    state: ScreenState<MonthsView>,
    history: HistoryView? = null,
    /** A month another screen asked for ("2025-10"; null key for the current one), taken once. */
    open: MonthAsk? = null,
    /** The ask was taken: coming back to Mês later keeps whatever month was picked then. */
    onOpened: () -> Unit = {},
    onRefresh: () -> Unit,
) {
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(open) {
        if (open != null) {
            picked = open.key
            onOpened()
        }
    }
    ScreenFrame("Mês", state, { it.readAt }, onRefresh, miaTopic = "mes") { v ->
        val idx = v.months.indexOfFirst { it.key == (picked ?: v.current) }.takeIf { it >= 0 }
            ?: v.months.indexOfFirst { it.key == v.current }.coerceAtLeast(0)
        val m = v.months.getOrNull(idx)
        if (m == null) {
            item {
                Panel {
                    QuietMark(64.dp)
                    Text("A planilha não tem meses para mostrar.", color = LocalLedger.current.muted)
                }
            }
            return@ScreenFrame
        }
        full {
            MonthNav(
                m,
                prev = v.months.getOrNull(idx - 1)?.let { p -> { picked = p.key } },
                next = v.months.getOrNull(idx + 1)?.let { n -> { picked = n.key } },
            )
        }
        item { Hero(m, v.months.filter { it.year == m.year }, history.takeIf { m.key == v.current }) { picked = it } }
        if (m.days.isNotEmpty()) item { Thermo(m, v.today, v.saving) }
        column()
        if (m.outflows.isNotEmpty()) item { Outflows(m) }
        v.reserve?.let { r -> item { ReservePanel(r, v.years.firstOrNull { it.year == m.year }) } }
    }
}

/**
 * The method's emergency reserve, as on the site: cost of living times 6 to 12 months, against
 * what the sheet shows as kept, plus the year's Economia (the sheet's tab of the same name).
 */
@Composable
internal fun ReservePanel(r: Reserve, year: YearTotals?) {
    val l = LocalLedger.current
    Panel {
        PanelHead(Learn.RESERVE_TITLE) {
            Text(
                if (r.kept > 0) "${Learn.coveredLabel(r.coveredTenths)} de 6" else "Nada guardado ainda",
                color = l.muted,
                style = MaterialTheme.typography.labelLarge,
            )
        }
        if (r.kept > 0) {
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = l.text, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)) { append(money(r.kept)) }
                    append("  guardados na planilha")
                },
                color = l.muted,
                style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"),
            )
        }
        // Display only: kept over the 6-month goal, full past it.
        Meter(if (r.min <= 0) 0f else r.kept.toFloat() / r.min, color = l.accent)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            LedgerLine(Learn.costLabel(r.costMonths), money(r.cost))
            LedgerLine("Meta de 6 meses", money(r.min))
            if (year != null && year.saved > 0) {
                LedgerLine("Em ${year.year}" + (year.savedShare?.let { " · $it% das entradas" } ?: ""), money(year.saved))
            }
        }
        Text(
            if (r.kept > 0) Learn.RESERVE_RULE else "${Learn.RESERVE_RULE} ${Learn.RESERVE_EMPTY}",
            color = l.muted,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun MonthNav(m: MonthItem, prev: (() -> Unit)?, next: (() -> Unit)?) {
    val l = LocalLedger.current
    // Capped like the site's 26rem, so on a tablet the arrows stay next to the month.
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Row(Modifier.widthIn(max = 416.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            MonthArrow(R.drawable.ic_chevron_left, "Mês anterior", prev)
            Text(
                "${capitalize(monthName(m.month))} ${m.year}",
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f),
            )
            MonthArrow(R.drawable.ic_chevron_right, "Próximo mês", next)
        }
    }
}

@Composable
private fun MonthArrow(icon: Int, label: String, go: (() -> Unit)?) {
    val l = LocalLedger.current
    val haptics = LocalHapticFeedback.current
    androidx.compose.material3.IconButton(
        onClick = {
            haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
            go?.invoke()
        },
        enabled = go != null,
    ) {
        androidx.compose.material3.Icon(
            androidx.compose.ui.res.painterResource(icon),
            contentDescription = label,
            tint = if (go != null) l.text else l.border,
        )
    }
}

@Composable
private fun Hero(m: MonthItem, year: List<MonthItem>, history: HistoryView?, onPick: (String) -> Unit) {
    val l = LocalLedger.current
    var ledger by remember(m.key) { mutableStateOf(false) }
    // The sheet's own balance on the month's last day: a date, not a guess (as on the site).
    val ends = if (m.past) "Terminou com"
    else "Saldo em ${shortDate(java.time.YearMonth.of(m.year, m.month).atEndOfMonth().toString())}"
    Panel {
        PanelHead(ends)
        BigMoney(m.endSheet, if (m.endSheet < 0) l.neg else l.text)
        history?.let { Evolution(it) }
        Columns(
            items = year.map { x ->
                Bar(
                    key = x.key,
                    label = capitalize(monthName(x.month).take(1)),
                    value = x.endSheet,
                    description = "${capitalize(monthName(x.month))}: ${money(x.endSheet)}" + if (x.future) ", previsão da planilha" else "",
                    picked = x.key == m.key,
                    faint = x.future,
                )
            },
            onSelect = onPick,
        )
        // A sample of the bar itself, as on the site: "claras" read wrong in the dark theme.
        if (year.any { it.future }) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(10.dp).background(l.border, CircleShape))
            Text("Previsão da planilha", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        m.result?.let { r ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Saldo ${if (r < 0) "desceu" else "subiu"} no mês", color = l.muted)
                Text(
                    money(kotlin.math.abs(r)),
                    style = MaterialTheme.typography.titleMedium,
                    color = when {
                        r > 0 -> l.pos
                        r < 0 -> l.neg
                        else -> l.text
                    },
                )
            }
        }
        if (m.saved > 0) {
            // The label wraps and the amount never does, as in the extrato.
            LedgerLine(
                "Guardado" + (m.savedShare?.let { " · $it% das entradas" } ?: ""),
                money(m.saved),
                valueStyle = MaterialTheme.typography.titleMedium,
            )
        }
        // A closed month keeps the wins its recap celebrated, for whoever looks back at it.
        WinsBox(m.wins, "${capitalize(monthName(m.month))} de ${m.year}")
        TextAction(if (ledger) "Esconder extrato" else "Ver extrato", { ledger = !ledger }, open = ledger)
        Reveal(ledger) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                LedgerLine("Começou com", money(m.startBalance))
                LedgerLine("Entradas", signed(m.entrada, '+'), l.pos)
                LedgerLine("Saídas", signed(m.saida, '−'))
                // Zero when the diário goes on the card: it is in the bills, under Saídas.
                if (m.diario != 0L) LedgerLine("Diário", signed(m.diario, '−'))
                LedgerLine(ends, money(m.endSheet), if (m.endSheet < 0) l.neg else l.text, total = true)
            }
            m.result?.let { r ->
                Text(
                    "O saldo ${if (r < 0) "desceu" else "subiu"} é a diferença entre o começo e o fim do mês. " +
                        "Dinheiro guardado também sai da conta, então um mês em que você economizou pode aparecer com o saldo descendo.",
                    color = l.muted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            if (m.saved > 0) {
                LedgerLine("Custo de vida", money(m.livingCost), total = true)
                Text(
                    "Custo de vida é o que saiu sem contar o que foi guardado. A reserva de emergência do método " +
                        "cobre de 6 a 12 meses desse custo. Para guardar, o método sugere de 20% a 30% das entradas.",
                    color = l.muted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

/** How the current month's end moved since the first reading of the month, under the figure. */
@Composable
private fun Evolution(h: HistoryView) {
    val l = LocalLedger.current
    val first = h.points.firstOrNull() ?: return
    val delta = h.delta ?: return
    // Against the month's end as the sheet showed it on the first reading, so it never reads as
    // money the balance gained this month (that is "Saldo subiu" or "desceu" below), as on the site.
    val day = shortDate(first.today)
    // Neutral, and naming the forecast: it is a change in the projection, not a result, so it
    // never competes with the colored "Saldo desceu" below, as on the site.
    val text = if (delta == 0L) "Igual ao previsto em $day"
    else "${money(kotlin.math.abs(delta))} ${if (delta > 0) "a mais" else "a menos"} que o previsto em $day"
    Text(text, color = l.muted, style = MaterialTheme.typography.labelLarge)
}

@Composable
internal fun LedgerLine(
    label: String,
    value: String,
    color: androidx.compose.ui.graphics.Color = LocalLedger.current.text,
    total: Boolean = false,
    /** The amount's own style, when it stands out from its label (Guardado on the hero). */
    valueStyle: androidx.compose.ui.text.TextStyle? = null,
) {
    val l = LocalLedger.current
    val style = if (total) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium
    // The label wraps and the value never does: with large text a long label used to squeeze the
    // amount to one character per line. Past 1.5× the two stack instead.
    if (LocalDensity.current.fontScale > 1.5f) {
        // Label and amount are read as one line by TalkBack.
        Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}) {
            Text(label, color = if (total) l.text else l.muted, style = style)
            Text(value, color = color, style = valueStyle ?: style, softWrap = false)
        }
    } else {
        Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(label, color = if (total) l.text else l.muted, style = style, modifier = Modifier.weight(1f))
            Text(value, color = color, style = valueStyle ?: style, softWrap = false)
        }
    }
}

@Composable
private fun Outflows(m: MonthItem) {
    val l = LocalLedger.current
    var all by remember(m.key) { mutableStateOf(false) }
    val top = m.outflows.first().amount
    val rest = m.outflows.size - OUTFLOWS_SHOWN
    Panel {
        // The arrows' legend lives in the head, not in a line of its own under the list.
        val compared = m.outflows.any { (it.change ?: 0L) != 0L }
        PanelHead("Para onde foi") {
            Text(
                when {
                    compared -> "▲▼ Comparado a ${monthName(if (m.month == 1) 12 else m.month - 1)}"
                    m.outflows.size == 1 -> "1 destino"
                    else -> "${m.outflows.size} destinos"
                },
                color = l.faint,
                style = MaterialTheme.typography.labelMedium,
            )
        }
        (if (all) m.outflows else m.outflows.take(OUTFLOWS_SHOWN)).forEach { OutflowRow(it, top) }
        if (rest > 0) TextAction(if (all) "Ver menos" else "Ver mais $rest", { all = !all }, open = all)
        if (m.fixed.isNotEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                androidx.compose.material3.Icon(painterResource(R.drawable.ic_repeat), contentDescription = null, tint = l.faint, modifier = Modifier.size(14.dp))
                Text("Fixos somam ${money(m.fixedTotal)} no mês", color = l.faint, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

@Composable
private fun OutflowRow(o: Outflow, top: Long) {
    val l = LocalLedger.current
    val change = o.change ?: 0L
    var open by rememberSaveable(o.label) { mutableStateOf(false) }
    Column {
        ListRow(
            name = o.label,
            value = money(o.amount),
            // The whole line opens the destination's last months, as on the site.
            modifier = Modifier.clickable(onClickLabel = "ver os últimos meses") { open = !open },
            avatar = if (o.kind == "card") monogram(o.label) else o.label.take(1).uppercase(),
            // What the line is about, when its words say so; otherwise a card, a fixed line that repeats or a bill (as on the site).
            avatarIcon = if (o.kind == "card") R.drawable.ic_card else if (o.fixed != null) R.drawable.ic_repeat else R.drawable.ic_receipt,
            avatarVector = if (o.kind == "card") null else categoryIcon(o.label),
            card = o.label.takeIf { o.kind == "card" },
            meta = o.fixed?.installment?.let(::installmentLine),
            chips = { if (o.others) Chip("De outra pessoa", ChipTone.Plain) },
            open = open.takeIf { o.trend.isNotEmpty() },
            below = {
                // Display only: the line's amount scaled to the month's largest line.
                Meter(if (top <= 0) 0f else o.amount.toFloat() / top)
                if (change != 0L) {
                    // The head already says what the arrows compare to; the words stay for TalkBack, as on the site.
                    val said = "${money(kotlin.math.abs(change))} ${if (change > 0) "a mais" else "a menos"} que no mês anterior"
                    Text(
                        "${if (change > 0) "▲" else "▼"} ${money(kotlin.math.abs(change))}",
                        modifier = Modifier.semantics { contentDescription = said },
                        color = if (change > 0) l.neg else l.faint,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            },
        )
        Reveal(open && o.trend.isNotEmpty()) { Trend(o.trend) }
    }
}

/** Where one destination went over the last months: tap a column to read it, as on the site. */
@Composable
internal fun Trend(points: List<TrendPoint>) {
    val l = LocalLedger.current
    val last = points.last()
    var picked by remember(points) { mutableStateOf("${last.year}-${last.month}") }
    val shown = points.firstOrNull { "${it.year}-${it.month}" == picked } ?: last
    Column(Modifier.padding(start = 48.dp, top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Columns(
            items = points.map { p ->
                val k = "${p.year}-${p.month}"
                Bar(
                    key = k,
                    label = capitalize(monthName(p.month).take(3)),
                    value = p.amount,
                    description = "${capitalize(monthName(p.month))}: ${money(p.amount)}",
                    picked = k == picked,
                )
            },
            onSelect = { picked = it },
            height = 64.dp,
        )
        Text(
            "${capitalize(monthName(shown.month))} de ${shown.year}: " +
                if (shown.amount > 0) money(shown.amount) else "não apareceu",
            color = l.faint,
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

/** "13 de 36 · Faltam R$ 1.006,00 até set 2028", under an installment's name. */
private fun installmentLine(i: Installment) =
    "${i.paid} de ${i.total}" +
        if (i.left > 0) " · Faltam ${money(i.left)} até ${monthName(i.ends.month).take(3)} ${i.ends.year}" else ""
