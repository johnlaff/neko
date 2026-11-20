@file:OptIn(ExperimentalLayoutApi::class)

package dev.johnlaff.neko.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.BankLine
import dev.johnlaff.neko.data.ParcelMonth
import dev.johnlaff.neko.data.ParcelPlan
import dev.johnlaff.neko.data.ParcelSide
import dev.johnlaff.neko.data.Parcels
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.money

/**
 * Faturas › Parcelas, as the site draws it (web/faturas/Parcels.tsx, specs/008-parcelas): every
 * purchase in parcels, the owner's apart from each person's; the month's weight, the months ahead
 * with only what was already bought, and when each plan ends with what it frees.
 */

/** A plan's name, without the bank's "05/10". */
internal fun planName(description: String) = bankLineName(BankLine(description, 0, installment = 1))

/** `5 de 10`, or when the first parcel comes on a later bill. */
private fun progress(p: ParcelPlan) =
    if (p.installment == 0) "1ª em ${monthYear(p.first)}" else "${p.installment} de ${p.installments}"

/** How much of the income and of the ceiling, when there is one to compare with. */
@Composable
private fun Weight(ofIncome: Int?, ofCeiling: Int?, onTint: Boolean = false) {
    if (ofIncome == null && ofCeiling == null) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        ofIncome?.let { Chip("$it% da renda", ChipTone.Plain, onTint = onTint) }
        ofCeiling?.let { Chip("$it% do teto", ChipTone.Plain, onTint = onTint) }
    }
}

/** Faturas' Parcelas panel: the owner's parcels on the month's bills, a glance at the months ahead. */
@Composable
internal fun ParcelsPanel(side: ParcelSide, month: String, onOpen: () -> Unit) {
    val l = LocalLedger.current
    val shown = side.months.dropWhile { it.key != month }
    val here = shown.firstOrNull() ?: return
    Panel {
        PanelHead("Parcelas") {
            Text(countOf(here.plans, "compra", "compras"), color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Nas faturas de ${monthWord(here.key)}", color = l.muted)
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                BigMoney(here.amount)
                here.ofIncome?.let { Chip("$it% da renda", ChipTone.Plain) }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            MiniColumns(
                shown.map { it.amount },
                "Parcelas de ${monthWord(here.key)} a ${monthYear(side.last)}, de ${money(here.amount)} a ${money(shown.last().amount)}",
            )
            Row(Modifier.fillMaxWidth().clearAndSetSemantics {}) {
                Text(shortMonthWord(here.key), color = l.faint, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                Text("Última em ${monthYear(side.last)}", color = l.faint, style = MaterialTheme.typography.labelMedium)
            }
        }
        TextAction("Ver todas ›", onOpen, color = l.accent)
    }
}

/** The panel's columns: the first in ink, the months ahead quieter, read in full on the page. */
@Composable
private fun MiniColumns(values: List<Long>, description: String) {
    val l = LocalLedger.current
    val top = (values.maxOrNull() ?: 0L).coerceAtLeast(1L).toFloat()
    Canvas(Modifier.fillMaxWidth().height(40.dp).clearAndSetSemantics { contentDescription = description }) {
        val n = values.size
        val w = 10.dp.toPx().coerceAtMost(size.width / (n * 1.5f).coerceAtLeast(1f))
        val step = if (n > 1) (size.width - w) / (n - 1) else 0f
        values.forEachIndexed { i, v ->
            val h = (size.height * (v / top)).coerceAtLeast(size.height * 0.04f).coerceAtLeast(2.dp.toPx())
            drawRoundRect(
                if (i == 0) l.text else l.borderInput,
                topLeft = Offset(i * step, size.height - h),
                size = Size(w, h),
                cornerRadius = CornerRadius(w / 2, w / 2),
            )
        }
    }
}

/** The page's name and, with someone else's parcels too, whose to show. */
@Composable
internal fun ParcelsHead(view: Parcels, side: ParcelSide, onSide: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        PageTitle("Parcelas")
        if (view.sides.size > 1) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).selectableGroup()
                    .semantics { contentDescription = "De quem são as parcelas" },
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                view.sides.forEach { s ->
                    Choice(s.person ?: "Suas", s.person == side.person, count = s.count) { onSide(s.person.orEmpty()) }
                }
            }
        }
    }
}

/** What the month's bills carry, its weight and what changed since the month before. */
@Composable
internal fun ParcelsHero(side: ParcelSide, view: Parcels, hasPage: Boolean, onHoje: () -> Unit, onPerson: (String) -> Unit) {
    val l = LocalLedger.current
    val own = side.person == null
    Panel {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                if (own) "Nas faturas de ${monthWord(view.month)}" else "${side.person} te paga nas faturas de ${monthWord(view.month)}",
                color = l.muted,
            )
            BigMoney(side.now)
            if (own) Weight(side.ofIncome, side.ofCeiling)
            else Chip("Fora da sua renda e do teto", ChipTone.Plain)
            side.previous?.let { prev ->
                val diff = side.now - prev.amount
                val vs = if (diff == 0L) "Igual a ${monthWord(prev.month)}"
                else "${money(kotlin.math.abs(diff))} a ${if (diff < 0) "menos" else "mais"} que em ${monthWord(prev.month)}"
                Text(vs, color = l.faint, style = MaterialTheme.typography.bodySmall)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LedgerLine(if (own) "Falta pagar" else "Falta ${side.person} pagar", money(side.left))
            LedgerLine("Última parcela", monthYear(side.last))
        }
        // Whether the sheet's bills already carry these parcels, where the figure is.
        if (view.short.isEmpty()) Text("✓ As faturas da planilha já têm essas parcelas", color = l.pos, style = MaterialTheme.typography.bodySmall)
        else {
            val one = view.short.singleOrNull()
            Text(
                if (one != null) "A planilha tem ${money(one.missing)} a menos na fatura do ${one.card} de ${monthWord(one.due.take(7))}"
                else "A planilha tem ${money(view.shortBy)} a menos em ${view.short.size} faturas",
                color = l.warn,
                style = MaterialTheme.typography.bodySmall,
            )
            // Para lançar has the change: nothing is written without a tap.
            TextAction("Corrigir em Para lançar ›", onHoje, color = l.accent)
        }
        if (view.leftOut.isNotEmpty()) {
            Text("Sem detalhe do banco, ficam de fora: ${view.leftOut.joinToString(", ")}.", color = l.faint, style = MaterialTheme.typography.bodySmall)
        }
        if (!own && hasPage) TextAction("Ver o mês de ${side.person} ›", { onPerson(side.person) }, color = l.accent)
    }
}

/** Month by month: a tap on a column says its weight and which plans end on it. */
@Composable
internal fun ParcelsMonths(side: ParcelSide, start: String, today: String) {
    val l = LocalLedger.current
    // No month picked yet: the hero already says the first one, so nothing below repeats it.
    var sel by rememberSaveable(side.person) { mutableStateOf<String?>(null) }
    // With every month alike (one plan), the columns would say nothing the hero does not.
    if (side.months.map { it.amount }.distinct().size < 2) return
    val pick: ParcelMonth? = side.months.firstOrNull { it.key == sel }
    val picked = pick?.key ?: start
    val many = side.months.size > 12
    Panel {
        PanelHead("Mês a mês") {
            Text("Só o que já foi comprado", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        Columns(
            items = side.months.mapIndexed { i, m ->
                Bar(
                    key = m.key,
                    // Past a year of months, a label every third keeps them apart.
                    label = if (!many || i % 3 == 0) shortMonthWord(m.key) else "",
                    value = m.amount,
                    description = "${capitalize(monthLong(m.key, today))}: ${money(m.amount)}",
                    picked = m.key == picked,
                )
            },
            onSelect = { sel = it },
        )
        if (pick != null) Column(
            Modifier.fillMaxWidth().background(l.surface2, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 10.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(capitalize(monthLong(pick.key, today)), fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text(money(pick.amount), fontWeight = FontWeight.SemiBold)
            }
            Weight(pick.ofIncome, pick.ofCeiling, onTint = true)
            Text(
                if (pick.ending.isNotEmpty()) "Última parcela neste mês: ${pick.ending.joinToString(", ") { planName(it) }}."
                else "Nenhuma compra acaba neste mês.",
                color = l.muted,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

/** One dot per parcel: filled up to this month's, as `5 de 10` says beside it. */
@Composable
private fun Dots(p: ParcelPlan) {
    val l = LocalLedger.current
    FlowRow(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        repeat(p.installments) { i ->
            val m = Modifier.size(6.dp)
            if (i < p.installment) Box(m.background(l.text, CircleShape)) else Box(m.border(1.dp, l.borderInput, CircleShape))
        }
    }
}

/** When each plan ends, soonest first, with what it frees; then the ones that just ended. */
@Composable
internal fun ParcelsList(side: ParcelSide, onPick: (ParcelPlan) -> Unit) {
    val l = LocalLedger.current
    // Every plan on the same card: its name on each row would only repeat.
    val oneCard = (side.groups.flatMap { it.plans } + side.ended?.plans.orEmpty()).map { it.card }.distinct().size == 1
    Panel {
        PanelHead("Quando acabam") {
            Text(countOf(side.count, "compra", "compras"), color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        val head = @Composable { title: String, right: String? ->
            FlowRow(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(title, color = l.muted, style = MaterialTheme.typography.labelLarge, modifier = Modifier.semantics { heading() })
                right?.let { Text(it, color = l.muted, style = MaterialTheme.typography.labelMedium) }
            }
        }
        side.groups.forEach { g ->
            key(g.last) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    // With one plan, its own figure already says it.
                    head("Última em ${monthYear(g.last)}", if (g.plans.size > 1) "Libera ${money(g.frees)} por mês" else null)
                    g.plans.forEach { p ->
                        key(p.card, p.description, p.first, p.amount) {
                            ListRow(
                                name = planName(p.description),
                                value = money(p.part),
                                modifier = Modifier.clickable(onClickLabel = "abrir") { onPick(p) },
                                avatar = initialOf(planName(p.description)),
                                avatarVector = categoryIcon(p.description),
                                meta = listOfNotNull(
                                    p.card.takeUnless { oneCard },
                                    "falta ${money(p.left)}".takeIf { p.installment < p.installments },
                                ).joinToString(" · ").ifEmpty { null }?.let(::capitalize),
                                chips = {
                                    if (p.installment <= 1) Chip("Nova", ChipTone.Ok)
                                    if (p.share != null) Chip("Dividida", ChipTone.Plain)
                                },
                                inlineChips = true,
                                below = {
                                    Row(
                                        Modifier.padding(top = 4.dp).clearAndSetSemantics { contentDescription = progress(p) },
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        Box(Modifier.weight(1f, fill = false)) { Dots(p) }
                                        Text(progress(p), color = l.faint, style = MaterialTheme.typography.labelMedium)
                                    }
                                },
                                next = true,
                            )
                        }
                    }
                }
            }
        }
        side.ended?.let { e ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                head(
                    "${if (e.plans.size == 1) "Acabou" else "Acabaram"} em ${monthYear(e.month)}",
                    if (e.plans.size > 1) "Liberou ${money(e.amount)} por mês" else null,
                )
                e.plans.forEach { p ->
                    key(p.card, p.description, p.first, p.amount) {
                        ListRow(
                            name = planName(p.description),
                            value = money(p.part),
                            avatar = "",
                            avatarIcon = R.drawable.ic_check,
                            accent = true,
                            meta = (if (oneCard) "" else "${p.card} · ") + "${p.installments} de ${p.installments} pagas",
                        )
                    }
                }
            }
        }
    }
}

/** One plan in its sheet: the timeline, what was paid and what is left, and whose it is. */
@Composable
internal fun ParcelDetail(
    p: ParcelPlan,
    side: String?,
    month: String,
    people: List<String>,
    waits: List<String>,
    onSave: (person: String?, share: Long?, after: (Boolean) -> Unit) -> Unit,
    onCard: () -> Unit,
    onDone: () -> Unit,
) {
    val l = LocalLedger.current
    Text("${p.card} · primeira em ${monthYear(p.first)}", color = l.muted)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(if (side == null) "Por mês" else "$side paga por mês", color = l.muted)
        BigMoney(p.part)
    }
    // One step per bill, the current one in ink.
    FlowRow(
        Modifier.fillMaxWidth().clearAndSetSemantics {
            contentDescription = (if (p.installment == 0) "Nenhuma parcela paga" else "Parcela ${p.installment} de ${p.installments}") +
                ", de ${monthYear(p.first)} a ${monthYear(p.last)}"
        },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        repeat(p.installments) { i ->
            val paid = i < p.installment - 1
            val now = i == p.installment - 1
            Column(Modifier.width(34.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                val bar = Modifier.fillMaxWidth().height(6.dp)
                val pill = RoundedCornerShape(50)
                when {
                    now -> Box(bar.background(l.text, pill))
                    paid -> Box(bar.background(l.muted, pill))
                    else -> Box(bar.border(1.dp, l.borderInput, pill))
                }
                Text(
                    shortMonthWord(monthAfter(p.first, i)),
                    color = if (now) l.text else l.faint,
                    fontWeight = if (now) FontWeight.SemiBold else null,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    softWrap = false,
                )
            }
        }
    }
    val left = p.installments - maxOf(1, p.installment) + 1
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (p.installment > 1) LedgerLine(countOf(p.installment - 1, "parcela paga", "parcelas pagas"), money(p.paid))
        LedgerLine(
            when {
                p.installment == 0 -> countOf(left, "parcela a pagar", "parcelas a pagar")
                left == 1 -> "Falta só a de ${monthWord(month)}"
                else -> "$left a pagar, com a de ${monthWord(month)}"
            },
            money(p.left),
        )
        LedgerLine("Última parcela", monthYear(p.last))
    }
    when {
        p.theirCard -> Text(
            if (p.person != null && p.person != p.card) "Está no ${p.card}, e a fatura desse cartão já é toda de ${p.person}."
            else "A fatura desse cartão já é toda de outra pessoa.",
            color = l.muted,
            style = MaterialTheme.typography.bodySmall,
        )
        p.key != null -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("De quem é?", style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
            OwnerForm(
                amount = p.amount,
                current = p.person?.let { OwnerNow(it, p.share) },
                installments = p.installments,
                due = null,
                monthly = false,
                people = people,
                waits = waits,
                onSave = onSave,
                onDone = onDone,
            )
        }
    }
    if (p.installment > 0) TextAction("Ver na fatura de ${monthWord(month)} ›", onCard, color = l.accent)
}

/** A card's Parcelas filter: what they add up to on this bill, when the last ends, and all of them. */
@Composable
internal fun ParcelsSum(total: Long, until: String?, onAll: () -> Unit) {
    val l = LocalLedger.current
    Column(
        Modifier.fillMaxWidth().background(l.surface2, RoundedCornerShape(12.dp)).padding(start = 12.dp, end = 12.dp, top = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Parcelas nesta fatura", color = l.muted, modifier = Modifier.weight(1f))
            Text(money(total), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
        }
        until?.let { Text("A última acaba em ${monthYear(it)}", color = l.faint, style = MaterialTheme.typography.bodySmall) }
        TextAction("Ver todas as parcelas ›", onAll, color = l.accent)
    }
}
