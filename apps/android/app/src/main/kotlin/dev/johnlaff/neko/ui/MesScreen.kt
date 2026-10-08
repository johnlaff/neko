package dev.johnlaff.neko.ui

import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.Fixed
import dev.johnlaff.neko.data.HistoryView
import dev.johnlaff.neko.data.MonthItem
import dev.johnlaff.neko.data.MonthsView
import dev.johnlaff.neko.data.Outflow
import dev.johnlaff.neko.data.Reserve
import dev.johnlaff.neko.data.YearTotals
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.monthName
import dev.johnlaff.neko.ui.Format.shortDate
import dev.johnlaff.neko.ui.Format.signed

/** Lines shown before "Ver mais", as on the site. */
private const val OUTFLOWS_SHOWN = 5
private const val FIXED_SHOWN = 4

/** The site's Mês (web/screens/Mes.tsx): how a month ends, where the money went, what is fixed. */
@Composable
fun MesScreen(state: ScreenState<MonthsView>, history: HistoryView? = null, onRefresh: () -> Unit) {
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    ScreenFrame("Mês", state, { it.readAt }, onRefresh) { v ->
        val idx = v.months.indexOfFirst { it.key == (picked ?: v.current) }.takeIf { it >= 0 }
            ?: v.months.indexOfFirst { it.key == v.current }.coerceAtLeast(0)
        val m = v.months.getOrNull(idx)
        if (m == null) {
            item {
                Panel {
                    Mascot(Pose.Searching, Modifier.height(96.dp))
                    Text("A planilha não tem meses para mostrar.", color = LocalLedger.current.muted)
                }
            }
            return@ScreenFrame
        }
        item {
            MonthNav(
                m,
                prev = v.months.getOrNull(idx - 1)?.let { p -> { picked = p.key } },
                next = v.months.getOrNull(idx + 1)?.let { n -> { picked = n.key } },
            )
        }
        item { Hero(m, v.months.filter { it.year == m.year }, history.takeIf { m.key == v.current }) { picked = it } }
        if (m.days.isNotEmpty()) item { Thermo(m, v.today, v.saving) }
        if (m.outflows.isNotEmpty()) item { Outflows(m) }
        if (m.fixed.isNotEmpty()) item { FixedPanel(m) }
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
        // Display only: kept over the 6-month goal, full past it.
        Meter(if (r.min <= 0) 0f else r.kept.toFloat() / r.min, color = l.accent)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            LedgerLine(Learn.costLabel(r.costMonths), money(r.cost))
            LedgerLine("6 meses", money(r.min))
            LedgerLine("12 meses", money(r.max))
            LedgerLine("Guardado na planilha", money(r.kept), total = true)
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
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
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

@Composable
private fun MonthArrow(icon: Int, label: String, go: (() -> Unit)?) {
    val l = LocalLedger.current
    androidx.compose.material3.IconButton(onClick = { go?.invoke() }, enabled = go != null) {
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
    val ends = if (m.past) "Terminou com" else "Termina com"
    Panel {
        PanelHead(ends) { Chip(if (m.past) "Fechado" else "Previsão", ChipTone.Plain) }
        BigMoney(m.endSheet, if (m.endSheet < 0) l.neg else l.text)
        history?.let { Evolution(it) }
        Columns(
            items = year.map { x ->
                Bar(
                    key = x.key,
                    label = capitalize(monthName(x.month).take(1)),
                    value = x.endSheet,
                    description = "${capitalize(monthName(x.month))}: ${money(x.endSheet)}",
                    accent = x.key == m.key,
                    faint = x.future,
                )
            },
            onSelect = onPick,
        )
        m.result?.let { r ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${if (r < 0) "Falta" else "Sobra"} ${if (m.past) "do mês" else "prevista"}", color = l.muted)
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
            Row(
                Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("Guardado" + (m.savedShare?.let { " · $it% das entradas" } ?: ""), color = l.muted)
                Text(money(m.saved), style = MaterialTheme.typography.titleMedium)
            }
        }
        // A closed month keeps the wins its recap celebrated, for whoever looks back at it.
        WinsBox(m.wins.mapNotNull(Copy::win), 48.dp)
        TextAction(if (ledger) "Esconder extrato" else "Ver extrato", { ledger = !ledger })
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
                    "${if (r < 0) "Falta" else "Sobra"} é quanto o saldo ${if (r < 0) "desceu" else "subiu"} no mês. " +
                        "Dinheiro guardado também sai da conta, então um mês em que você economizou pode aparecer com falta.",
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
    val since = "desde ${shortDate(first.today)}"
    val style = MaterialTheme.typography.labelLarge
    if (delta == 0L) {
        Text("Igual $since", color = l.muted, style = style)
        return
    }
    Row(Modifier.semantics(mergeDescendants = true) {
        contentDescription = "${if (delta > 0) "Melhorou" else "Piorou"} ${money(kotlin.math.abs(delta))} $since"
    }) {
        Text("${if (delta > 0) "▲" else "▼"} ${money(kotlin.math.abs(delta))} ", color = if (delta > 0) l.pos else l.neg, style = style)
        Text(since, color = l.muted, style = style)
    }
}

@Composable
internal fun LedgerLine(label: String, value: String, color: androidx.compose.ui.graphics.Color = LocalLedger.current.text, total: Boolean = false) {
    val l = LocalLedger.current
    val style = if (total) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = if (total) l.text else l.muted, style = style)
        Text(value, color = color, style = style)
    }
}

@Composable
private fun Outflows(m: MonthItem) {
    val l = LocalLedger.current
    var all by remember(m.key) { mutableStateOf(false) }
    val top = m.outflows.first().amount
    val rest = m.outflows.size - OUTFLOWS_SHOWN
    Panel {
        PanelHead("Para onde foi") {
            Text(
                if (m.outflows.size == 1) "1 destino" else "${m.outflows.size} destinos",
                color = l.faint,
                style = MaterialTheme.typography.labelMedium,
            )
        }
        (if (all) m.outflows else m.outflows.take(OUTFLOWS_SHOWN)).forEach { OutflowRow(it, top) }
        if (rest > 0) TextAction(if (all) "Ver menos" else "Ver mais $rest", { all = !all })
        if (m.outflows.any { (it.change ?: 0L) != 0L }) {
            val before = monthName(if (m.month == 1) 12 else m.month - 1)
            Text("▲▼ Comparado a $before", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
private fun OutflowRow(o: Outflow, top: Long) {
    val l = LocalLedger.current
    val change = o.change ?: 0L
    ListRow(
        name = o.label,
        value = money(o.amount),
        avatar = if (o.kind == "card") monogram(o.label) else o.label.take(1).uppercase(),
        chips = { if (o.others) Chip("De outra pessoa", ChipTone.Plain) },
        below = {
            // Display only: the line's amount scaled to the month's largest line.
            Meter(if (top <= 0) 0f else o.amount.toFloat() / top)
            if (change != 0L) {
                Text(
                    "${if (change > 0) "▲" else "▼"} ${money(kotlin.math.abs(change))} ${if (change > 0) "a mais" else "a menos"}",
                    color = if (change > 0) l.neg else l.faint,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        },
    )
}

@Composable
private fun FixedPanel(m: MonthItem) {
    val l = LocalLedger.current
    var all by remember(m.key) { mutableStateOf(false) }
    val rest = m.fixed.size - FIXED_SHOWN
    Panel {
        PanelHead("Fixos do mês") { Text(money(m.fixedTotal), color = l.faint, style = MaterialTheme.typography.labelMedium) }
        (if (all) m.fixed else m.fixed.take(FIXED_SHOWN)).forEach { FixedRow(it) }
        if (rest > 0) TextAction(if (all) "Ver menos" else "Ver mais $rest", { all = !all })
    }
}

@Composable
private fun FixedRow(f: Fixed) {
    val i = f.installment
    ListRow(
        name = f.label,
        value = money(f.amount),
        avatar = f.label.take(1).uppercase(),
        meta = i?.let {
            "${it.paid} de ${it.total}" +
                if (it.left > 0) " · Faltam ${money(it.left)} até ${monthName(it.ends.month).take(3)} ${it.ends.year}" else ""
        },
        below = {
            // Display only: installments paid out of the total.
            if (i != null && i.total > 0) Meter(i.paid.toFloat() / i.total)
        },
    )
}
