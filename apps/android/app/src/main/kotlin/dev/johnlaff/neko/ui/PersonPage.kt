package dev.johnlaff.neko.ui

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.BankLine
import dev.johnlaff.neko.data.Owed
import dev.johnlaff.neko.data.OwedItem
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.shortDate

private fun itemLine(i: OwedItem) = BankLine(i.description, i.amount, i.date, i.installment, i.installments, i.key)

/** `parcela 3 de 6 · faltam R$ 675,00`, or the day of the purchase. */
internal fun itemWhen(i: OwedItem): String? {
    val n = i.installment
    val total = i.installments
    if (n != null && total != null && total > 1) {
        return "parcela $n de $total" + if (i.later > 0) " · faltam ${money(i.later)}" else " · última"
    }
    return i.date?.let(::shortDate)
}

/**
 * What the owner sends the person, word for word with the site: each line of the month with its
 * value, and the total.
 */
internal fun messageOf(o: Owed, month: String): String = (
    listOf("Oi, ${o.person}! Sua parte nas faturas de ${monthWord(month)}:") +
        listOfNotNull(o.card?.let { "• ${it.card}: ${money(it.amount)} (vence ${slashDate(it.due)})" }) +
        o.items.map { i ->
            val what = when {
                i.installment != null && (i.installments ?: 1) > 1 -> " (parcela ${i.installment} de ${i.installments})"
                i.part < i.amount -> " (sua parte de ${money(i.amount)})"
                else -> ""
            }
            "• ${bankLineName(itemLine(i))}$what: ${money(i.part)}"
        } +
        "Total: ${money(o.total)}"
    ).joinToString("\n")

/**
 * One person's month on the owner's bills (the site's Person, web/faturas/Person.tsx), as Splitwise
 * shows a friend's balance: the total, the parcels still to come, and a message to send them. Neko
 * sends nothing by itself: Android's share sheet does, on the owner's tap.
 */
@Composable
internal fun PersonHead(o: Owed, month: String) {
    val l = LocalLedger.current
    val context = LocalContext.current
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PersonAvatar(o.person, 40)
            Column(Modifier.weight(1f)) {
                PageTitle(o.person)
                Text("Te paga nas faturas de ${monthWord(month)}", color = l.faint, style = MaterialTheme.typography.labelMedium)
            }
        }
        BigMoney(o.total)
        if (o.later > 0) Text(
            "Depois de ${monthWord(month)} ainda vêm ${money(o.later)} em parcelas" + (o.until?.let { ", até ${monthYear(it)}" } ?: "") + ".",
            color = l.muted,
            style = MaterialTheme.typography.bodySmall,
        )
        Button(
            onClick = {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, messageOf(o, month))
                }
                runCatching { context.startActivity(Intent.createChooser(send, "Mandar para ${o.person}")) }
            },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.buttonColors(containerColor = l.text, contentColor = l.bg),
        ) {
            Icon(painterResource(R.drawable.ic_share), contentDescription = null, tint = l.bg, modifier = Modifier.size(18.dp))
            androidx.compose.foundation.layout.Spacer(Modifier.width(8.dp))
            Text("Mandar para ${o.person}", color = l.bg, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
        }
        Text("O Neko não manda nada sozinho: você escolhe para onde a mensagem vai.", color = l.muted, style = MaterialTheme.typography.bodySmall)
    }
}

/**
 * Their own card's bill on its own line, their purchases on the owner's cards below (a tap asks
 * whose it is), and when their part goes into the sheet: on the due day, or when their Pix lands.
 */
@Composable
internal fun PersonLines(o: Owed, actions: FaturasActions, onPick: (OwedItem) -> Unit) {
    val l = LocalLedger.current
    // The tap shows at once; the screen read again with the choice takes over.
    var pending by remember(o.onArrival) { mutableStateOf<Boolean?>(null) }
    var failed by remember { mutableStateOf(false) }
    val onArrival = pending ?: o.onArrival
    Panel {
        o.card?.let { c ->
            ListRow(
                name = c.card,
                value = money(c.amount),
                avatar = monogram(c.card),
                card = c.card,
                meta = "Fatura inteira · vence ${shortDate(c.due)}",
            )
        }
        if (o.items.isNotEmpty()) {
            if (o.card != null) HorizontalDivider(color = l.border)
            PanelHead("Nos seus cartões") {
                Text(countOf(o.items.size, "compra", "compras"), color = l.faint, style = MaterialTheme.typography.labelMedium)
            }
            o.items.forEachIndexed { n, i ->
                key("${i.key}|${i.card}|${i.description}|${i.date}|$n") {
                    ListRow(
                        name = bankLineName(itemLine(i)),
                        value = money(i.part),
                        modifier = Modifier.clickable(onClickLabel = "de quem é") { onPick(i) },
                        avatar = "",
                        avatarVector = categoryIcon(i.description),
                        avatarIcon = R.drawable.ic_receipt,
                        meta = listOfNotNull(i.card, itemWhen(i), if (i.part < i.amount) "de ${money(i.amount)}" else null).joinToString(" · "),
                        next = true,
                    )
                }
            }
        }
        HorizontalDivider(color = l.border)
        Text(
            "Quando a parte de ${o.person} entra na planilha",
            color = l.muted,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.semantics { heading() },
        )
        Row(Modifier.fillMaxWidth().semantics { contentDescription = "Quando a parte de ${o.person} entra na planilha" }, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(false to "No vencimento", true to "Quando o Pix cair").forEach { (k, label) ->
                Box(Modifier.weight(1f)) {
                    Choice(label, onArrival == k, fill = true) {
                        if (onArrival == k) return@Choice
                        pending = k
                        failed = false
                        actions.person(o.person, k) { ok ->
                            if (!ok) {
                                pending = null
                                failed = true
                            }
                        }
                    }
                }
            }
        }
        Text(
            if (onArrival) "Nada fica planejado: quando o Pix de ${o.person} cair, ele aparece em Para lançar como Entrada."
            else "Cada parte vai para Para lançar como Entrada no dia em que a fatura vence. Um Pix adiantado de ${o.person} diminui essa Entrada.",
            color = l.muted,
            style = MaterialTheme.typography.bodySmall,
        )
        if (failed) Failed("Não salvou. Tente de novo.")
    }
}
