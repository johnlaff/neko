@file:OptIn(ExperimentalLayoutApi::class)

package dev.johnlaff.neko.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.BankLine
import dev.johnlaff.neko.data.InvoiceRow
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.shortDate

/** A card's mark: its bank's when the name points to a known one, else two letters. */
@Composable
internal fun CardMark(card: String, size: Dp = 40.dp) {
    val l = LocalLedger.current
    val bank = institutionOf(card)
    if (bank != null) {
        Box(Modifier.size(size).background(Color(bank.bg), CircleShape), contentAlignment = Alignment.Center) {
            Icon(painterResource(bank.mark), contentDescription = null, tint = Color(bank.fg), modifier = Modifier.size(size * 0.6f))
        }
    } else {
        Box(Modifier.size(size).background(l.surface2, CircleShape), contentAlignment = Alignment.Center) {
            Text(monogram(card), color = l.muted, style = MaterialTheme.typography.labelMedium)
        }
    }
}

/** Under a purchase's name: its parcel and plan, whose part it is, where it came from. */
private fun lineMeta(l: BankLine): String? = listOfNotNull(
    parcelLabel(l),
    l.person?.let { p ->
        val part = l.part
        if (part != null && part < l.amount) "Dividida · $p paga ${money(part)}" else "De $p"
    },
    "da fatura em PDF".takeIf { l.fromStatement },
).joinToString(" · ").ifEmpty { null }

/**
 * One card's bill on a page of its own (the site's CardBill, web/faturas/CardBill.tsx): the total,
 * how much of it is the owner's and how much someone else's, the bill's facts and months.
 */
@Composable
internal fun CardHead(c: InvoiceRow, month: String, today: String, onPickMonth: (String) -> Unit) {
    val l = LocalLedger.current
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            CardMark(c.card)
            Column(Modifier.weight(1f)) {
                PageTitle(c.card)
                Text(billStateLine(c, today), color = l.faint, style = MaterialTheme.typography.labelMedium)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Na planilha", color = l.muted)
            BigMoney(c.amount)
        }
        // The bill's facts on their own tinted block.
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
        // The bank's purchases split by whose, under the bank's own figure.
        c.split?.let { s ->
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Das compras no banco", color = l.faint, style = MaterialTheme.typography.labelMedium, modifier = Modifier.semantics { heading() })
                SplitBar(
                    maxOf(0L, s.mine),
                    s.theirs.map { it.amount },
                    "Das compras no banco: seu ${money(s.mine)}, " + s.theirs.joinToString(", ") { "de ${it.person} ${money(it.amount)}" },
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    KeyDot(l.text, "Seu ${money(s.mine)} · conta no teto")
                    s.theirs.forEach { t -> KeyDot(l.accent, "${t.person} ${money(t.amount)}") }
                }
            }
        }
        if (c.history.count { it.amount != 0L } > 1) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Faturas do ${c.card}", color = l.faint, style = MaterialTheme.typography.labelMedium, modifier = Modifier.semantics { heading() })
                Columns(
                    items = c.history.map { h ->
                        Bar(
                            key = h.month,
                            label = shortMonthWord(h.month),
                            value = h.amount,
                            description = "${capitalize(monthWord(h.month))}: ${money(h.amount)}",
                            picked = h.month == month,
                            faint = h.month > today.take(7),
                        )
                    },
                    // A month without this card's bill would show nothing: that bar opens nothing.
                    onSelect = { k -> if (c.history.any { it.month == k && it.amount != 0L }) onPickMonth(k) },
                    height = 72.dp,
                )
            }
        }
    }
}

/**
 * The bank's purchases on a card's bill, by day and newest first, with the parcels of older
 * purchases together at the end, filtered by kind or by person. A tap asks whose it is.
 */
@Composable
internal fun CardLines(c: InvoiceRow, today: String, people: List<String>, onPick: (BankLine) -> Unit) {
    val l = LocalLedger.current
    val lines = c.bank?.lines.orEmpty()
    var filter by rememberSaveable(c.card) { mutableStateOf("all") }
    val persons = lines.mapNotNull { it.person }.distinct()
    val filters = listOf(
        Triple("all", "Tudo", lines.size),
        Triple("buys", "Compras", lines.count { !isParcel(it) }),
        Triple("parcels", "Parcelas", lines.count(::isParcel)),
    ) + persons.map { p -> Triple("p:$p", p, lines.count { it.person == p }) }
    val pass = { x: BankLine ->
        filter == "all" || (filter == "buys" && !isParcel(x)) || (filter == "parcels" && isParcel(x)) ||
            (filter.startsWith("p:") && x.person == filter.removePrefix("p:"))
    }
    val shown = lines.filter(pass)
    val groups = shown.filterNot(::isParcel).sortedByDescending { it.date.orEmpty() }
        .groupBy { x -> x.date?.let { buyDay(it, today) } ?: "Sem data" }.toList() +
        listOfNotNull(shown.filter(::isParcel).takeIf { it.isNotEmpty() }?.let { "Parcelas" to it })
    Panel {
        PanelHead("Compras no banco")
        if (lines.isEmpty()) {
            Text(
                if (c.bank != null) "O banco ainda não mandou compras desta fatura."
                else "Este cartão não está ligado a um banco, então as compras não aparecem aqui.",
                color = l.muted,
                style = MaterialTheme.typography.bodySmall,
            )
            return@Panel
        }
        // One line of filters that slides sideways, as the site's.
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).selectableGroup().semantics { contentDescription = "Mostrar" },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            filters.filter { it.third > 0 || it.first == "all" }.forEach { (k, label, n) ->
                Choice(label, filter == k, count = n) { filter = k }
            }
        }
        Text("Toque numa compra para dizer de quem é, ou para dividir.", color = l.muted, style = MaterialTheme.typography.bodySmall)
        groups.forEach { (day, items) ->
            key(day) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(day, color = l.muted, style = MaterialTheme.typography.labelLarge, modifier = Modifier.semantics { heading() })
                    items.forEachIndexed { i, x ->
                        // The bank sends the same text twice for two equal purchases: the index tells them apart.
                        key("${x.description}-${x.date}-$i") {
                            val theirs = x.person != null
                            ListRow(
                                name = bankLineName(x),
                                value = money(x.amount),
                                modifier = if (x.key != null) Modifier.clickable(onClickLabel = "de quem é") { onPick(x) } else Modifier,
                                avatar = "",
                                avatarVector = categoryIcon(x.description),
                                avatarIcon = R.drawable.ic_receipt,
                                valueColor = if (theirs) l.muted else l.text,
                                accent = theirs,
                                meta = lineMeta(x),
                                next = x.key != null,
                            )
                        }
                    }
                }
            }
        }
    }
}
