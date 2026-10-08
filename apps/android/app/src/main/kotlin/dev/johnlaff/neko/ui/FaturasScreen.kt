package dev.johnlaff.neko.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.BankBills
import dev.johnlaff.neko.data.BillBar
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.data.UsualBill
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.days
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.monthName
import dev.johnlaff.neko.ui.Format.shortDate

/** The site's Faturas (web/screens/Faturas.tsx): the usual bill, its history, where to buy today. */
@Composable
fun FaturasScreen(state: ScreenState<InvoicesView>, onRefresh: () -> Unit, onAjustes: () -> Unit) {
    ScreenFrame("Faturas", state, { it.readAt }, onRefresh) { v ->
        if (!v.hasCards) {
            item {
                Panel {
                    QuietMark(64.dp)
                    Text("Nenhuma fatura", style = MaterialTheme.typography.headlineSmall)
                    Text(Learn.CARDS_COME_FROM, color = LocalLedger.current.muted)
                }
            }
            return@ScreenFrame
        }
        v.usual?.let { u -> item { UsualPanel(u) } }
        if (v.history.isNotEmpty()) item { History(v) }
        if (v.buyToday.isNotEmpty()) item { BuyToday(v, onAjustes) }
        if (v.others.isNotEmpty() || v.empty.isNotEmpty()) item { Others(v) }
        v.bank?.let { b -> item { BankBills(b, onAjustes) } }
    }
}

private fun shortMonth(iso: String) = capitalize(monthName(iso.substring(5, 7).toInt()).take(3))

@Composable
private fun UsualPanel(u: UsualBill) {
    Panel {
        PanelHead(u.card, card = u.card) {
            // An estimated day says so, as everywhere else: ≈
            Chip(
                (if (u.closingEstimated) "≈ " else "") + Format.closesIn(u.closesInDays),
                if (u.closesInDays <= 3) ChipTone.Warn else ChipTone.Ok,
            )
        }
        BigMoney(u.onSheet)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Timeline()
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Step("Fecha", shortDate(u.closing), if (u.closingEstimated) "Estimado" else null, Alignment.Start, Modifier.weight(1f))
                Step("Vence", shortDate(u.due), "Sai da conta", Alignment.End, Modifier.weight(1f))
            }
        }
        Hint("faturas", Learn.FATURAS)
    }
}

/**
 * Closing then due as the two ends of one line across the card (the site's `.timeline`): the
 * closing dot is lit, as it is the next thing to happen; the due dot is an open ring.
 */
@Composable
private fun Timeline() {
    val l = LocalLedger.current
    Canvas(Modifier.fillMaxWidth().height(12.dp)) {
        val r = 6.dp.toPx()
        val y = size.height / 2
        val ring = 2.dp.toPx()
        drawLine(l.borderInput, Offset(r, y), Offset(size.width - r, y), ring)
        drawCircle(l.warn.copy(alpha = 0.22f), r + 4.dp.toPx(), Offset(r, y))
        drawCircle(l.warn, r, Offset(r, y))
        drawCircle(l.surface, r, Offset(size.width - r, y))
        drawCircle(l.borderInput, r - ring / 2, Offset(size.width - r, y), style = Stroke(ring))
    }
}

@Composable
private fun Step(label: String, date: String, sub: String?, align: Alignment.Horizontal, modifier: Modifier) {
    val l = LocalLedger.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp), horizontalAlignment = align) {
        Text(label, color = l.muted, style = MaterialTheme.typography.labelMedium)
        Text(date, style = MaterialTheme.typography.titleMedium)
        sub?.let { Text(it, color = l.faint, style = MaterialTheme.typography.labelMedium) }
    }
}

@Composable
private fun History(v: InvoicesView) {
    val l = LocalLedger.current
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    val shown: BillBar = v.history.firstOrNull { it.due == picked } ?: v.history.last()
    Panel {
        PanelHead("Histórico") {
            v.openVsAverage?.let { d ->
                Chip(
                    "${money(kotlin.math.abs(d))} ${if (d <= 0) "abaixo" else "acima"} da média",
                    if (d <= 0) ChipTone.Ok else ChipTone.Warn,
                )
            }
        }
        // The open bill is already the hero's number: until a bar is picked, the line shows the
        // average the bars are read against.
        val average = v.historyAverage?.takeIf { picked == null }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (average != null) "- - Média" else "${shortMonth(shown.due)}${if (shown.open) ", aberta" else ""}",
                color = l.muted,
            )
            Text(money(average ?: shown.amount), style = MaterialTheme.typography.titleMedium)
        }
        Columns(
            items = v.history.map { b ->
                Bar(
                    key = b.due,
                    label = shortMonth(b.due),
                    value = b.amount,
                    description = "${shortMonth(b.due)}${if (b.open) ", fatura aberta" else ""}: ${money(b.amount)}",
                    picked = b.due == shown.due,
                )
            },
            onSelect = { picked = it },
            guide = v.historyAverage,
        )
    }
}

@Composable
private fun BuyToday(v: InvoicesView, onAjustes: () -> Unit) {
    val l = LocalLedger.current
    Panel {
        PanelHead("Comprar hoje") {
            Text("Mais prazo primeiro", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        v.buyToday.forEachIndexed { i, g ->
            // The first group waits longest; every card in it is as good as the others.
            ListRow(
                name = g.cards.joinToString(", "),
                value = days(g.payInDays),
                avatar = monogram(g.cards.first()),
                card = g.cards.first(),
                accent = i == 0,
                meta = "Paga em ${shortDate(g.due)} · Melhor dia ${if (g.estimated) "≈ " else ""}${shortDate(g.bestDate)}",
            )
        }
        if (v.buyToday.any { it.estimated }) TextAction("Dias com ≈ são estimados. Corrigir em Ajustes", onAjustes)
    }
}

@Composable
private fun Others(v: InvoicesView) {
    val l = LocalLedger.current
    Panel {
        PanelHead("Outros cartões")
        v.others.forEach { c ->
            ListRow(
                name = c.card,
                value = money(c.onSheet),
                avatar = monogram(c.card),
                card = c.card,
                meta = "Vence ${shortDate(c.due)}",
                chips = {
                    if (c.others) Chip("De outra pessoa", ChipTone.Plain)
                    if (c.reimbursed) Chip("Reembolsada", ChipTone.Plain)
                },
            )
        }
        if (v.empty.isNotEmpty()) {
            Text("Sem compras: ${v.empty.joinToString(", ")}.", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
    }
}

/**
 * The next bills as the bank already has them (as on the site): purchases so far plus the parcels
 * still owed, next to what the sheet expects. Only a bill already above the sheet gets color.
 */
@Composable
private fun BankBills(b: BankBills, onAjustes: () -> Unit) {
    val l = LocalLedger.current
    Panel {
        PanelHead("Faturas no banco") {
            b.syncedAt?.let { Text("Lido ${shortDate(it.take(10))}", color = l.faint, style = MaterialTheme.typography.labelMedium) }
        }
        if (b.bills.isEmpty()) {
            Text("Nenhuma fatura futura dos cartões ligados.", color = l.muted)
            TextAction("Ligar cartões em Ajustes", onAjustes)
        }
        b.bills.forEach { c ->
            ListRow(
                name = "${c.card} · ${shortMonth(c.due)}",
                value = money(c.bank),
                avatar = monogram(c.card),
                card = c.card,
                meta = "Planilha ${money(c.sheet)}" + when {
                    c.parcels > 0 && c.parcels == c.bank -> " · No banco, só parcelas"
                    c.parcels > 0 -> " · Parcelas ${money(c.parcels)}"
                    else -> ""
                },
                chips = { if (c.gap > 0) Chip("${money(c.gap)} acima da planilha", ChipTone.Warn) },
            )
        }
    }
}
