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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.BankLine
import dev.johnlaff.neko.data.BuyGroup
import dev.johnlaff.neko.data.InvoiceMonth
import dev.johnlaff.neko.data.InvoiceRow
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.data.Owed
import dev.johnlaff.neko.data.Subscriptions
import dev.johnlaff.neko.ui.Format.bankText
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.days
import dev.johnlaff.neko.ui.Format.merchantName
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
fun FaturasScreen(
    state: ScreenState<InvoicesView>,
    onRefresh: () -> Unit,
    onAjustes: () -> Unit,
    /** Para lançar lives on Hoje: where a bill the bank disagrees with gets fixed. */
    onHoje: () -> Unit = {},
    /** Marks a subscription to cancel, or takes the mark off. */
    onCancel: (key: String, on: Boolean) -> Unit = { _, _ -> },
    /** Marks a purchase as someone else's, or as yours again (null). */
    onOwner: (key: String, person: String?) -> Unit = { _, _ -> },
    /** The last mark of whose a purchase is did not save. */
    ownerFailed: Boolean = false,
) {
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
        item { MonthsPanel(v, month, onHoje) { picked = it } }
        column()
        item { CardsPanel(month, v.today, Owners(v.people, onOwner, ownerFailed)) { picked = it } }
        if (month.owed.isNotEmpty()) item { OwedPanel(month) }
        if (v.buyToday.isNotEmpty()) item { BuyToday(v.buyToday, onAjustes) }
        v.subscriptions?.let { item { SubscriptionsPanel(it, onCancel) } }
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
    }.replace(' ', '\u00a0') // a wrap falls at the "·", never inside the date

/** Where the bill stands, in one line: the row's only words besides its name. */
private fun stateLine(c: InvoiceRow, today: String): String =
    (if (c.others) "De outra pessoa · " else if (c.reimbursed) "Reembolsada · " else "") + billState(c, today)

private fun billState(c: InvoiceRow, today: String): String {
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
private fun MonthsPanel(v: InvoicesView, m: InvoiceMonth, onHoje: () -> Unit, onPick: (String) -> Unit) {
    val l = LocalLedger.current
    Panel {
        PanelHead("Por mês") {
            v.bank?.syncedAt?.let { Text("Banco lido ${shortDate(it.take(10))}", color = l.faint, style = MaterialTheme.typography.labelMedium) }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("${if (m.past) "Saiu da conta" else "Sai da conta"} em ${monthOf(m.key)}", color = l.muted)
            BigMoney(m.total)
            m.bank?.let { b ->
                if (b.disagree == 0) Text("✓ Banco não ultrapassa a planilha", color = l.pos)
                else {
                    Text(
                        if (b.disagree == 1) "${m.cards.firstOrNull { it.bank?.disagrees == true }?.card ?: "1 cartão"} não confere com o banco" else "${b.disagree} cartões não conferem com o banco",
                        color = l.warn,
                    )
                    // Para lançar has the change for each one: nothing is written without a tap.
                    TextAction("Corrigir em Para lançar ›", onHoje, color = l.accent)
                }
            }
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
            if (v.months.any { it.future }) Key("Meses à frente: só o que já está na planilha") {
                Box(Modifier.size(width = 8.dp, height = 14.dp).border(1.5.dp, l.faint, CircleShape))
            }
        }
        Hint("faturas", Learn.FATURAS)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CardsPanel(m: InvoiceMonth, today: String, owners: Owners, onPick: (String) -> Unit) {
    val l = LocalLedger.current
    Panel {
        PanelHead("Cartões") {
            Text("Vencem em ${monthOf(m.key)}", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        if (m.cards.isEmpty()) Text("Nenhuma fatura neste mês.", color = l.muted)
        // By card only: it stays open while its chart picks another month.
        m.cards.forEach { key(it.card) { InvoiceLine(it, m.key, today, alone = m.cards.size == 1, owners, onPick) } }
    }
}

@Composable
private fun InvoiceLine(c: InvoiceRow, month: String, today: String, alone: Boolean, owners: Owners, onPick: (String) -> Unit) {
    var open by rememberSaveable(c.card) { mutableStateOf(false) }
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
                // The bank only shows up when the sheet should change.
                c.bank?.takeIf { it.disagrees }?.let { b ->
                    Chip("Banco ${if (b.gap > 0) "+" else "−"}${money(kotlin.math.abs(b.gap))}", ChipTone.Warn)
                }
            },
            open = open,
        )
        Reveal(open) { Detail(c, month, today, alone, owners, onPick) }
    }
}

/** `3/10 · Faltam 7`, the way a bill writes a parcel. */
private fun parcelText(l: BankLine): String? {
    val n = l.installment ?: return null
    val total = l.installments ?: return null
    return "$n/$total · " + if (total > n) "Faltam ${total - n}" else "Última"
}

/** The bank writes the parcel into the text too ("LOJA PARC 03/06"); the line already says it. */
internal fun bankLineName(l: BankLine) = bankText(
    Format.merchantName(
        if (l.installment == null) l.description
        else l.description.replace(Regex("""\s*(parc(ela)?\.?\s*)?\d{1,2}\s*/\s*\d{1,2}\s*$""", RegexOption.IGNORE_CASE), ""),
    ),
)

private const val LINES_SHOWN = 8

/** Who the bank's lines can be marked for, how to mark one, and whether the last mark failed. */
private data class Owners(val people: List<String>, val onOwner: (String, String?) -> Unit, val failed: Boolean)

@Composable
private fun BankLines(title: String, lines: List<BankLine>, owners: Owners, hint: Boolean) {
    if (lines.isEmpty()) return
    val l = LocalLedger.current
    var all by remember(lines) { mutableStateOf(false) }
    // Closed by default: a bill can bring dozens of lines, the details above come first.
    var open by rememberSaveable(title) { mutableStateOf(false) }
    var picking by remember(lines) { mutableStateOf<Int?>(null) }
    Column {
    // A full-width row with its chevron at the edge, like the card rows above it.
    Row(
        Modifier.fillMaxWidth().clickable { open = !open }.heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text("$title (${lines.size})", color = l.muted, style = MaterialTheme.typography.labelLarge)
        Disclosure(open, l.muted)
    }
    Reveal(open) { Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (hint) Text("Toque numa compra que é de outra pessoa.", color = l.muted, style = MaterialTheme.typography.bodySmall)
        (if (all) lines else lines.take(LINES_SHOWN)).forEachIndexed { i, x ->
            val when_ = parcelText(x) ?: x.date?.let(::shortDate)
            val tint = if (x.person != null) l.muted else l.text
            Column {
                Row(
                    Modifier.fillMaxWidth()
                        .background(if (picking == i) l.surface2 else androidx.compose.ui.graphics.Color.Transparent, RoundedCornerShape(8.dp))
                        .then(if (x.key != null) Modifier.clickable(onClickLabel = "marcar de quem é") { picking = if (picking == i) null else i } else Modifier)
                        .heightIn(min = 44.dp)
                        .padding(vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(bankLineName(x), style = MaterialTheme.typography.bodyMedium)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            // Someone else's: "De Bia", the amount quieter, never struck through
                            // (the money still leaves your account to pay the bill).
                            val meta = x.person?.let { "De $it" + (when_?.let { w -> " · $w" } ?: "") } ?: when_
                            meta?.let { Text(it, color = if (x.person != null) l.muted else l.faint, style = MaterialTheme.typography.labelMedium) }
                        }
                    }
                    Text(money(x.amount), color = tint, style = MaterialTheme.typography.bodyMedium)
                }
                val key = x.key
                // The picker stays open while saving; the screen read again with the mark closes it.
                if (picking == i && key != null) OwnerPick(x, key, owners)
            }
        }
        if (!all && lines.size > LINES_SHOWN) TextAction("Ver mais ${lines.size - LINES_SHOWN}", { all = true })
    } }
    }
}

/**
 * Whose a purchase is: someone named before, a new name, or yours again. A parcel takes its whole
 * plan along, so every later bill follows.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun OwnerPick(line: BankLine, key: String, owners: Owners) {
    val l = LocalLedger.current
    val people = owners.people
    var name by remember(key) { mutableStateOf("") }
    var saving by remember(key) { mutableStateOf(false) }
    // A failure seen before this tap is not this save's.
    var failedBefore by remember(key) { mutableStateOf(owners.failed) }
    if (saving && owners.failed && !failedBefore) saving = false
    val onPick = { person: String? ->
        failedBefore = false
        saving = true
        owners.onOwner(key, person)
    }
    Column(Modifier.padding(top = 4.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            if ((line.installments ?: 1) > 1) "De quem são estas parcelas? Vale para todas." else "De quem é esta compra?",
            color = l.muted,
            style = MaterialTheme.typography.bodySmall,
        )
        if (people.isNotEmpty() || line.person != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            people.forEach { p -> Choice(p, line.person == p) { if (line.person != p) onPick(p) } }
            if (line.person != null) Choice("É minha", false) { onPick(null) }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            androidx.compose.material3.OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(40) },
                singleLine = true,
                placeholder = { Text(if (people.isEmpty()) "Nome da pessoa" else "Outra pessoa", color = l.faint) },
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                    capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Words,
                    imeAction = androidx.compose.ui.text.input.ImeAction.Done,
                ),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { if (name.isNotBlank()) onPick(name.trim()) }),
                colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(focusedBorderColor = l.accent, unfocusedBorderColor = l.borderInput),
                modifier = Modifier.weight(1f).semantics { contentDescription = "Nome de outra pessoa" },
            )
            TextAction("Marcar", { onPick(name.trim()) }, enabled = name.isNotBlank() && !saving)
        }
        if (saving) Text("Salvando…", color = l.muted, style = MaterialTheme.typography.bodySmall)
        else if (owners.failed && !failedBefore) Text("Não salvou. Tente de novo.", color = l.warn, style = MaterialTheme.typography.bodySmall)
    }
}

/** Someone else's purchases on the month's bills: what each will pay back, and what comes later. */
@Composable
private fun OwedPanel(m: InvoiceMonth) {
    val l = LocalLedger.current
    Panel {
        PanelHead("A receber") {
            Text("Faturas de ${monthOf(m.key)}", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        m.owed.forEach { o -> key(o.person) { OwedLine(o) } }
        Text("Fica fora do teto das faturas. Quando pagarem, lance como Entrada.", color = l.muted, style = MaterialTheme.typography.bodySmall)
    }
}

/** One person: what they owe on the month's bills, opening into each purchase (as on the site). */
@Composable
private fun OwedLine(o: Owed) {
    val l = LocalLedger.current
    var open by rememberSaveable(o.person) { mutableStateOf(false) }
    Column {
        ListRow(
            name = o.person,
            value = money(o.total),
            modifier = Modifier.clickable(onClickLabel = if (open) "fechar compras" else "ver compras") { open = !open },
            // A person, not a card: one initial, in the accent's tint (as on the site).
            avatar = o.person.take(1).uppercase(),
            accent = true,
            meta = (if (o.lines == 1) "1 compra" else "${o.lines} compras") +
                if (o.later > 0) " · mais ${money(o.later)} nas próximas parcelas" else "",
            open = open,
        )
        Reveal(open) {
            Column(Modifier.padding(start = 48.dp, top = 8.dp, bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                o.items.forEach { i ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(bankLineName(BankLine(i.description, i.amount, installment = i.installment)), style = MaterialTheme.typography.bodyMedium)
                            Text(i.card + (i.due?.let { " · fatura vence ${shortDate(it)}" } ?: ""), color = l.faint, style = MaterialTheme.typography.labelMedium)
                            i.date?.let { Text("Compra de ${shortDate(it)}", color = l.faint, style = MaterialTheme.typography.labelMedium) }
                            val n = i.installment
                            val total = i.installments
                            if (n != null && total != null && total > 1) Text(
                                "Parcela $n de $total · " + if (i.later > 0) "faltam ${money(i.later)}" else "última",
                                color = l.faint,
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }
                        Text(money(i.amount), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

/** Everything about one card's bill, opened from its row; a month's only card has the top chart as its history. */
@Composable
private fun Detail(c: InvoiceRow, month: String, today: String, alone: Boolean, owners: Owners, onPick: (String) -> Unit) {
    val l = LocalLedger.current
    Column(Modifier.padding(start = 48.dp, top = 4.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        // The bill's facts on their own tinted block, set apart from the bank's lines below.
        Column(
            Modifier.fillMaxWidth().background(l.surface2, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            LedgerLine("Fecha", shortDate(c.closing) + if (c.closingEstimated) " (estimado)" else "")
            c.bank?.let { b ->
                LedgerLine(if (b.closed) "No banco, fechada" else "No banco até agora", money(b.amount), color = if (b.disagrees) l.warn else l.text)
            }
            c.limit?.let { x -> LedgerLine("Limite livre", money(x.available)) }
        }
        if (!alone && c.history.count { it.amount != 0L } > 1) {
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
                    // A month without this card's bill would close it: those bars stay put.
                    onSelect = { k -> if (c.history.any { it.month == k && it.amount != 0L }) onPick(k) },
                    height = 64.dp,
                )
            }
        }
        c.bank?.let { b ->
            // The lists say their lines can be tapped until someone has been named once.
            BankLines("Compras novas no banco", b.lines.filter { (it.installments ?: 1) <= 1 }, owners, hint = owners.people.isEmpty())
            BankLines("Parcelas no banco", b.lines.filter { (it.installments ?: 1) > 1 }, owners, hint = owners.people.isEmpty())
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

/**
 * Charges of the same value back each month on the owner's cards, with a mark for the ones to
 * cancel: the method tags them all to cancel on one day. Only what was charged; nothing ahead.
 */
@Composable
private fun SubscriptionsPanel(subs: Subscriptions, onCancel: (String, Boolean) -> Unit) {
    val l = LocalLedger.current
    // The tap shows at once; the next read of the screen brings the Worker's own marks.
    var marks by remember(subs) { mutableStateOf(subs.items.associate { it.key to it.cancel }) }
    Panel {
        PanelHead("Assinaturas") {
            Text("${money(subs.total)} por mês", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        Text("Marque o que você vai cancelar.", color = l.muted, style = MaterialTheme.typography.bodySmall)
        subs.items.forEach { i ->
            key(i.key) {
                val name = bankText(merchantName(i.description))
                val on = marks[i.key] ?: i.cancel
                ListRow(
                    name = name,
                    value = money(i.amount),
                    meta = "${i.card} · ${i.charges} cobranças · última ${shortDate(i.last)}" +
                        if (i.twin) " · outro plano na mesma loja" else "",
                    chips = {
                        Toggle(if (on) "✓ Vou cancelar" else "Vou cancelar", on, "Vou cancelar $name") {
                            marks = marks + (i.key to !on)
                            onCancel(i.key, !on)
                        }
                    },
                )
            }
        }
        if (subs.toCancel > 0) Text("Marcadas: ${money(subs.toCancel)} a menos por mês", color = l.pos, style = MaterialTheme.typography.labelLarge)
    }
}
