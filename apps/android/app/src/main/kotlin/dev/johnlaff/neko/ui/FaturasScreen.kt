package dev.johnlaff.neko.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.BankLine
import dev.johnlaff.neko.data.BuyGroup
import dev.johnlaff.neko.data.InvoiceMonth
import dev.johnlaff.neko.data.InvoiceRow
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.ui.Format.bankText
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.days
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.monthName
import dev.johnlaff.neko.ui.Format.shortDate
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * The site's Faturas (web/screens/Faturas.tsx): every card's bills by month, the chosen month's
 * cards with the bank's check, and where to buy today.
 */
@Composable
fun FaturasScreen(state: ScreenState<InvoicesView>, onRefresh: () -> Unit, onAjustes: () -> Unit) {
    var picked by rememberSaveable { mutableStateOf<String?>(null) }
    ScreenFrame("Faturas", state, { it.readAt }, onRefresh, miaTopic = "faturas") { v ->
        val month = v.months.firstOrNull { it.key == (picked ?: v.current) } ?: v.months.lastOrNull()
        if (!v.hasCards || month == null) {
            item {
                Panel {
                    QuietMark(64.dp)
                    Text("Nenhuma fatura", style = MaterialTheme.typography.headlineSmall)
                    Text(Learn.CARDS_COME_FROM, color = LocalLedger.current.muted)
                }
            }
            return@ScreenFrame
        }
        item { MonthsPanel(v, month) { picked = it } }
        column()
        item { CardsPanel(month, v.today) }
        if (v.buyToday.isNotEmpty()) item { BuyToday(v.buyToday, onAjustes) }
    }
}

private fun monthOf(key: String) = monthName(key.substring(5, 7).toInt())
private fun shortMonth(key: String) = capitalize(monthOf(key).take(3))

/** `vence hoje`, `vence amanhã`, `vence 12 nov`, as on the site. */
private fun dueText(due: String, today: String) =
    when (ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(due))) {
        0L -> "vence hoje"
        1L -> "vence amanhã"
        else -> "vence ${shortDate(due)}"
    }

/** Where the bill stands, in one line: the row's only words besides its name. */
private fun stateLine(c: InvoiceRow, today: String): String {
    if (c.state == "due") return "Venceu ${shortDate(c.due)}"
    val due = dueText(c.due, today)
    if (c.state == "closed" || c.bank?.closed == true) return "Fechada · $due"
    if (c.state == "future") return capitalize(due)
    val open = if (c.bank?.onlyParcels == true) "Só parcelas por enquanto"
    else Format.closesIn(c.closesInDays) + if (c.closingEstimated) " (estimado)" else ""
    return "$open · $due"
}

/** A sample of what a mark means, beside its words (the site's `.columns-key`). */
@Composable
private fun Key(text: String, mark: @Composable () -> Unit) {
    val l = LocalLedger.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        mark()
        Text(text, color = l.faint, style = MaterialTheme.typography.labelMedium)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MonthsPanel(v: InvoicesView, m: InvoiceMonth, onPick: (String) -> Unit) {
    val l = LocalLedger.current
    Panel {
        PanelHead("Por mês") {
            v.bank?.syncedAt?.let { Text("Banco lido ${shortDate(it.take(10))}", color = l.faint, style = MaterialTheme.typography.labelMedium) }
        }
        Columns(
            items = v.months.map { x ->
                Bar(
                    key = x.key,
                    label = shortMonth(x.key),
                    value = x.total,
                    description = "${capitalize(monthOf(x.key))}: ${money(x.total)}${if (x.future) ", já na planilha" else ""}",
                    picked = x.key == m.key,
                    faint = x.future,
                )
            },
            onSelect = onPick,
            guide = v.average,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            v.average?.let { a -> Key("Média ${money(a)}") { Text("- - -", color = l.muted, style = MaterialTheme.typography.labelMedium) } }
            if (v.months.any { it.future }) Key("À frente, o que já está na planilha") {
                Box(Modifier.size(10.dp).border(1.5.dp, l.faint, CircleShape))
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${if (m.past) "Saiu da conta" else "Sai da conta"} em ${monthOf(m.key)}", color = l.muted)
            BigMoney(m.total)
            m.bank?.let { b ->
                if (b.disagree == 0) Text("✓ Banco confere com a planilha", color = l.pos)
                else Text(
                    if (b.disagree == 1) "1 cartão não confere com o banco" else "${b.disagree} cartões não conferem com o banco",
                    color = l.warn,
                )
            }
        }
        Hint("faturas", Learn.FATURAS)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CardsPanel(m: InvoiceMonth, today: String) {
    val l = LocalLedger.current
    Panel {
        PanelHead(capitalize(monthOf(m.key))) {
            Text(if (m.cards.size == 1) "1 cartão" else "${m.cards.size} cartões", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        if (m.cards.isEmpty()) Text("Nenhuma fatura neste mês.", color = l.muted)
        m.cards.forEach { InvoiceLine(it, m.key, today) }
        m.bank?.takeIf { it.parcels > 0 }?.let { b ->
            val whole = (b.parcels + b.fresh).coerceAtLeast(1L)
            // Display only: the month's parcels against what is new, from the API's sums.
            Box(Modifier.fillMaxWidth().height(6.dp).background(l.text, RoundedCornerShape(50))) {
                Box(Modifier.fillMaxWidth(b.parcels.toFloat() / whole).height(6.dp).background(l.borderInput, RoundedCornerShape(50)))
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Key("Parcelas ${money(b.parcels)}") { Box(Modifier.size(10.dp).background(l.borderInput, CircleShape)) }
                Key("Compras novas ${money(b.fresh.coerceAtLeast(0L))}") { Box(Modifier.size(10.dp).background(l.text, CircleShape)) }
            }
        }
    }
}

@Composable
private fun InvoiceLine(c: InvoiceRow, month: String, today: String) {
    var open by rememberSaveable(month, c.card) { mutableStateOf(false) }
    Column {
        ListRow(
            name = c.card,
            value = money(c.amount),
            // The whole line opens the bill's details, as on the site.
            modifier = Modifier.clickable(onClickLabel = if (open) "fechar detalhes" else "ver detalhes") { open = !open },
            avatar = monogram(c.card),
            card = c.card,
            meta = stateLine(c, today),
            chips = {
                if (c.others) Chip("De outra pessoa", ChipTone.Plain)
                if (c.reimbursed) Chip("Reembolsada", ChipTone.Plain)
                // The bank only shows up when the sheet should change.
                c.bank?.takeIf { it.disagrees }?.let { b ->
                    Chip("Banco ${if (b.gap > 0) "+" else "−"}${money(kotlin.math.abs(b.gap))}", ChipTone.Warn)
                }
            },
            open = open,
        )
        Reveal(open) { Detail(c, month, today) }
    }
}

/** `3/10 · Faltam 7`, the way a bill writes a parcel. */
private fun parcelText(l: BankLine): String? {
    val n = l.installment ?: return null
    val total = l.installments ?: return null
    return "$n/$total · " + if (total > n) "Faltam ${total - n}" else "Última"
}

/** The bank writes the parcel into the text too ("LOJA PARC 03/06"); the line already says it. */
private fun lineName(l: BankLine) = bankText(
    if (l.installment == null) l.description
    else l.description.replace(Regex("""\s*(parc(ela)?\.?\s*)?\d{1,2}\s*/\s*\d{1,2}\s*$""", RegexOption.IGNORE_CASE), ""),
)

private const val LINES_SHOWN = 8

@Composable
private fun BankLines(title: String, lines: List<BankLine>) {
    if (lines.isEmpty()) return
    val l = LocalLedger.current
    var all by remember(lines) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, color = l.faint, style = MaterialTheme.typography.labelMedium)
        (if (all) lines else lines.take(LINES_SHOWN)).forEach { x ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(lineName(x), style = MaterialTheme.typography.bodyMedium)
                    (parcelText(x) ?: x.date?.let(::shortDate))?.let {
                        Text(it, color = l.faint, style = MaterialTheme.typography.labelMedium)
                    }
                }
                Text(money(x.amount), style = MaterialTheme.typography.bodyMedium)
            }
        }
        if (!all && lines.size > LINES_SHOWN) TextAction("Ver mais ${lines.size - LINES_SHOWN}", { all = true })
    }
}

/** Everything about one card's bill, opened from its row. */
@Composable
private fun Detail(c: InvoiceRow, month: String, today: String) {
    val l = LocalLedger.current
    Column(Modifier.padding(start = 48.dp, top = 4.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LedgerLine("Fecha", shortDate(c.closing) + if (c.closingEstimated) " (estimado)" else "")
            LedgerLine("Vence", shortDate(c.due))
            c.bank?.let { b ->
                LedgerLine(if (b.closed) "No banco, fechada" else "No banco até agora", money(b.amount), color = if (b.disagrees) l.warn else l.text)
            }
            c.limit?.let { x -> LedgerLine("Limite livre", "${money(x.available)} de ${money(x.limit)}") }
        }
        c.bank?.let { b ->
            BankLines("Compras novas", b.lines.filter { (it.installments ?: 1) <= 1 })
            BankLines("Parcelas", b.lines.filter { (it.installments ?: 1) > 1 })
        }
        if (c.history.count { it.amount != 0L } > 1) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Faturas do ${c.card}", color = l.faint, style = MaterialTheme.typography.labelMedium)
                Columns(
                    items = c.history.map { h ->
                        Bar(
                            key = h.month,
                            label = shortMonth(h.month),
                            value = h.amount,
                            description = "${capitalize(monthOf(h.month))}: ${money(h.amount)}",
                            picked = h.month == month,
                            faint = h.month > today.take(7),
                        )
                    },
                    onSelect = {},
                    height = 64.dp,
                )
            }
        }
    }
}

@Composable
private fun BuyLine(g: BuyGroup, best: Boolean) {
    ListRow(
        name = g.cards.joinToString(", "),
        value = "Paga em ${days(g.payInDays)}",
        avatar = monogram(g.cards.first()),
        card = g.cards.first(),
        accent = best,
        meta = "Vence ${shortDate(g.due)} · Melhor dia ${if (g.estimated) "≈ " else ""}${shortDate(g.bestDate)}",
    )
}

@Composable
private fun BuyToday(groups: List<BuyGroup>, onAjustes: () -> Unit) {
    val l = LocalLedger.current
    var all by rememberSaveable { mutableStateOf(false) }
    Panel {
        PanelHead("Comprar hoje") {
            Text("Mais prazo primeiro", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        BuyLine(groups.first(), best = true)
        if (groups.size > 1) {
            TextAction(if (all) "Ver menos" else "Ver todos", { all = !all }, open = all)
            Reveal(all) { groups.drop(1).forEach { BuyLine(it, best = false) } }
        }
        if (groups.any { it.estimated }) TextAction("Dias com ≈ são estimados. Corrigir em Ajustes", onAjustes)
    }
}
