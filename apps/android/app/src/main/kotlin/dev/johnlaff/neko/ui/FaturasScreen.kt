package dev.johnlaff.neko.ui

import android.util.Base64
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.BankLine
import dev.johnlaff.neko.data.BuyGroup
import dev.johnlaff.neko.data.InvoiceMonth
import dev.johnlaff.neko.data.InvoiceRow
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.data.Owed
import dev.johnlaff.neko.data.StatementAnswer
import dev.johnlaff.neko.data.Subscription
import dev.johnlaff.neko.data.SubscriptionMark
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.days
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.shortDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * What Faturas asks the Worker to change, each answering `after(true)` once saved and
 * `after(false)` when it did not save. The screenshots leave them all as no-ops that say saved.
 */
class FaturasActions(
    /** A subscription's decision (null leaves it), or "Não é assinatura" (hidden); then Faturas read again. */
    val subscription: (key: String, mark: SubscriptionMark?, hidden: Boolean?, after: (Boolean) -> Unit) -> Unit = { _, _, _, a -> a(true) },
    /** A decision in "Revisar uma a uma", saved without reading Faturas again. */
    val review: (key: String, mark: SubscriptionMark, after: (Boolean) -> Unit) -> Unit = { _, _, a -> a(true) },
    /** The review ended or was left: Faturas read again with its decisions. */
    val reviewed: () -> Unit = {},
    /** Whose a purchase is (person null: yours), and their part of each charge when split. */
    val owner: (key: String, person: String?, share: Long?, after: (Boolean) -> Unit) -> Unit = { _, _, _, a -> a(true) },
    /** When a person's part goes into the sheet: on the due day, or when their Pix lands. */
    val person: (person: String, onArrival: Boolean, after: (Boolean) -> Unit) -> Unit = { _, _, a -> a(true) },
)

/** A purchase whose owner is being picked in the "De quem é?" sheet. */
internal data class OwnerTarget(
    val key: String,
    /** The bank's text, for its icon. */
    val description: String,
    /** Its name as the rows write it. */
    val name: String,
    val amount: Long,
    /** Under its name: the card and the parcel or the day. */
    val meta: String,
    val current: OwnerNow?,
    val installments: Int?,
    val due: String?,
    val monthly: Boolean,
)

/**
 * The site's Faturas (web/screens/Faturas.tsx): every card's bills by month, the chosen month's
 * cards and who pays back what, where to buy today and the subscriptions. A card, a person and
 * "Revisar uma a uma" open pages of their own over it, which back closes; a purchase and a
 * subscription open a sheet.
 */
@Composable
fun FaturasScreen(
    state: ScreenState<InvoicesView>,
    onRefresh: () -> Unit,
    onAjustes: () -> Unit,
    /** Para lançar lives on Hoje: where a bill the bank disagrees with gets fixed. */
    onHoje: () -> Unit = {},
    actions: FaturasActions = FaturasActions(),
    /** The bank's bill PDF read, kept by the model so it outlives the screen; null keeps the option out. */
    statement: StatementRead? = null,
    /** Reads the bank's bill PDF (base64). */
    onStatement: (String) -> Unit = {},
    /** Where it opens: a month (`yyyy-MM`), and a page over it (`cartao:<card>`, `pessoa:<name>`, `revisar`). */
    startMonth: String? = null,
    startPage: String? = null,
) {
    var picked by rememberSaveable { mutableStateOf(startMonth) }
    var page by rememberSaveable { mutableStateOf(startPage) }
    var subOpen by rememberSaveable { mutableStateOf<String?>(null) }
    var owner by remember { mutableStateOf<OwnerTarget?>(null) }
    var gone by remember { mutableStateOf<Subscription?>(null) }
    BackHandler(enabled = page != null) { page = null }
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
        val p = page
        if (p != null) {
            full { BackRow("Faturas de ${monthWord(month.key)}") { page = null } }
            val gonePanel = { text: String -> item { Panel { Text(text, color = LocalLedger.current.muted) } } }
            when {
                p.startsWith("cartao:") -> {
                    val name = p.removePrefix("cartao:")
                    val c = month.cards.firstOrNull { it.card.equals(name, ignoreCase = true) }
                    if (c == null) gonePanel("$name não tem fatura em ${monthWord(month.key)}.")
                    else {
                        item { key(c.card, month.key) { CardHead(c, month.key, v.today) { picked = it } } }
                        column()
                        item {
                            key(c.card, month.key) {
                                CardLines(c, v.today, v.people) { x -> owner = cardTarget(c, x, month.key) }
                            }
                        }
                    }
                }
                p.startsWith("pessoa:") -> {
                    val name = p.removePrefix("pessoa:")
                    val o = month.owed.firstOrNull { it.person.equals(name, ignoreCase = true) }
                    if (o == null) gonePanel("Nada de $name nas faturas de ${monthWord(month.key)}.")
                    else {
                        item { key(o.person, month.key) { PersonHead(o, month.key) } }
                        column()
                        item { key(o.person, month.key) { PersonLines(o, actions) { i -> owner = personTarget(o, i) } } }
                    }
                }
                else -> {
                    val subs = v.subscriptions
                    if (subs == null) gonePanel("Nenhuma assinatura para revisar.")
                    else item { Review(subs, state.loading, actions) { page = null } }
                }
            }
            return@ScreenFrame
        }
        item { MonthsPanel(v, month, onHoje) { picked = it } }
        column()
        val pdf = statement.takeIf { v.bank != null }
        item { CardsPanel(month, v.today, pdf, onStatement, { picked = it }) { page = "cartao:$it" } }
        if (month.owed.isNotEmpty()) item { OwedPanel(month) { page = "pessoa:$it" } }
        if (v.buyToday.isNotEmpty()) item { BuyToday(v.buyToday, onAjustes) }
        v.subscriptions?.let { subs ->
            item {
                SubscriptionsPanel(subs, gone, actions, onOpen = { subOpen = it }, onUndone = { gone = null }) { page = "revisar" }
            }
        }
    }
    val v = state.view ?: return
    v.subscriptions?.items?.firstOrNull { it.key == subOpen }?.let { r ->
        Sheet("Assinatura", onClose = { subOpen = null }) {
            SubscriptionDetail(r, v.people, v.onArrival, actions) {
                gone = r
                subOpen = null
            }
        }
    }
    owner?.let { t ->
        Sheet("De quem é?", onClose = { owner = null }) {
            ListRow(
                name = t.name,
                value = money(t.amount),
                avatar = "",
                avatarVector = categoryIcon(t.description),
                avatarIcon = R.drawable.ic_receipt,
                meta = t.meta,
            )
            OwnerForm(
                amount = t.amount,
                current = t.current,
                installments = t.installments,
                due = t.due,
                monthly = t.monthly,
                people = v.people,
                waits = v.onArrival,
                onSave = { person, share, after -> actions.owner(t.key, person, share, after) },
                onDone = { owner = null },
            )
        }
    }
}

/** A purchase on a card's page, for "De quem é?". */
private fun cardTarget(c: InvoiceRow, x: BankLine, month: String) = OwnerTarget(
    key = x.key.orEmpty(),
    description = x.description,
    name = bankLineName(x),
    amount = x.amount,
    meta = "${c.card} · " + when {
        isParcel(x) -> "parcela ${x.installment} de ${x.installments}"
        x.date != null -> shortDate(x.date)
        else -> "fatura de ${monthWord(month)}"
    },
    current = x.person?.let { OwnerNow(it, x.part) },
    installments = x.installments,
    due = c.due,
    monthly = false,
)

/** One of a person's purchases, for "De quem é?" from their page. */
private fun personTarget(o: Owed, i: dev.johnlaff.neko.data.OwedItem) = OwnerTarget(
    key = i.key,
    description = i.description,
    name = bankLineName(BankLine(i.description, i.amount, installment = i.installment)),
    amount = i.amount,
    meta = listOfNotNull(i.card, itemWhen(i)?.let(::capitalize)).joinToString(" · "),
    current = OwnerNow(o.person, i.part.takeIf { it < i.amount }),
    installments = i.installments,
    due = i.due,
    monthly = i.key.endsWith("|mensal"),
)

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
            Text("${if (m.past) "Saiu da conta" else "Sai da conta"} em ${monthWord(m.key)}", color = l.muted)
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
                    label = shortMonthWord(x.key),
                    value = x.total,
                    description = "${capitalize(monthWord(x.key))}: ${money(x.total)}${if (x.future) ", já na planilha" else ""}",
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

@Composable
private fun CardsPanel(
    m: InvoiceMonth,
    today: String,
    statement: StatementRead?,
    onStatement: (String) -> Unit,
    onPickMonth: (String) -> Unit,
    onOpen: (String) -> Unit,
) {
    val l = LocalLedger.current
    Panel {
        PanelHead("Cartões") {
            Text("Vencem em ${monthWord(m.key)}", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        if (m.cards.isEmpty()) Text("Nenhuma fatura neste mês.", color = l.muted)
        m.cards.forEach { c -> key(c.card) { InvoiceLine(c, today) { onOpen(c.card) } } }
        statement?.let { StatementUpload(it, m.key, onStatement, onPickMonth) }
    }
}

/** A card's bill in the month's list: a tap opens its own page. */
@Composable
private fun InvoiceLine(c: InvoiceRow, today: String, onOpen: () -> Unit) {
    ListRow(
        name = c.card,
        value = money(c.amount),
        modifier = Modifier.clickable(onClickLabel = "abrir a fatura", onClick = onOpen),
        avatar = monogram(c.card),
        card = c.card,
        meta = billStateLine(c, today),
        chips = {
            // The bank only shows up when the sheet should change.
            c.bank?.takeIf { it.disagrees }?.let { b ->
                Chip("Banco ${if (b.gap > 0) "+" else "−"}${money(kotlin.math.abs(b.gap))}", ChipTone.Warn)
            }
        },
        next = true,
    )
}

/** Someone else's part of the month's bills: what each will pay back, each opening their page. */
@Composable
private fun OwedPanel(m: InvoiceMonth, onOpen: (String) -> Unit) {
    val l = LocalLedger.current
    Panel {
        PanelHead("A receber") {
            Text("Faturas de ${monthWord(m.key)}", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        m.owed.forEach { o ->
            key(o.person) {
                val what = listOfNotNull(o.card?.card, if (o.lines > 0) countOf(o.lines, "compra", "compras") else null)
                ListRow(
                    name = o.person,
                    value = money(o.total),
                    modifier = Modifier.clickable(onClickLabel = "abrir") { onOpen(o.person) },
                    // A person, not a card: one initial, in the accent's tint (as on the site).
                    avatar = o.person.take(1).uppercase(),
                    accent = true,
                    meta = what.joinToString(" e ") + if (o.later > 0) " · mais ${money(o.later)} em parcelas" else "",
                    next = true,
                )
            }
        }
        Text("Fica fora do teto. A parte de cada pessoa aparece em Para lançar como Entrada.", color = l.muted, style = MaterialTheme.typography.bodySmall)
    }
}

/** What a read of the bill PDF came to, in a sentence (the site's `statementText`). */
internal fun statementText(a: StatementAnswer): String {
    val bill = "Fatura que vence em ${shortDate(a.due ?: "")} lida"
    return when {
        a.read && a.added.isEmpty() ->
            "$bill: ${countOf(a.lines, "linha", "linhas")} em ${countOf(a.cards, "cartão", "cartões")}, e o banco já tinha mandado todas."
        a.read -> "$bill. Entraram nela ${countOf(a.added.size, "linha", "linhas")} que o banco não tinha mandado:"
        // A no-break space keeps "final" with its digits.
        a.reason == "mismatch" -> "As somas do PDF não fecharam" +
            (a.problems.firstNotNullOfOrNull { it.card }?.let { " no cartão final\u00a0$it" } ?: "") +
            ", então nada foi guardado. Envie de novo para outra leitura."
        a.reason == "account" -> "Não achei esses cartões nos bancos ligados. Confira os cartões em Ajustes › Bancos."
        a.reason == "paused" -> "O limite de IA do mês acabou. Volta em ${shortDate(a.pausedUntil ?: "")}."
        else -> "Não consegui ler esse PDF. Se ele pede senha, salve uma cópia sem senha e envie de novo."
    }
}

/** Faturas › "Ler a fatura do banco": the read on its way or its answer, kept while the app lives. */
class StatementRead(answer: StatementAnswer? = null) {
    var reading by mutableStateOf(false)
    var answer by mutableStateOf(answer)
    /** Why the last read did not come back, as `reasonOf` says it. */
    var failed by mutableStateOf<String?>(null)
}

/**
 * The bank's own bill, as a PDF: its lines fill in what Open Finance left out (a credit, the
 * second of two equal purchases). Optional: the bill e-mailed to the Neko address is read alone.
 */
@Composable
private fun StatementUpload(s: StatementRead, month: String, onRead: (String) -> Unit, onPick: (String) -> Unit) {
    val l = LocalLedger.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val bytes = runCatching {
                withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
            }.getOrNull()
            if (bytes == null) {
                s.answer = null
                s.failed = "Não consegui abrir esse arquivo. Tente de novo."
            } else onRead(Base64.encodeToString(bytes, Base64.NO_WRAP))
        }
    }
    Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        TextAction(
            "Ler a fatura do banco (PDF)",
            { pick.launch(arrayOf("application/pdf")) },
            color = if (s.reading) l.muted else l.accent,
            enabled = !s.reading,
        )
        Column(Modifier.semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (s.reading) Text("Lendo a fatura. Leva uns 2 minutos…", color = l.muted, style = MaterialTheme.typography.bodySmall)
            s.answer?.let { a ->
                Text(statementText(a), color = if (a.read) l.muted else l.warn, style = MaterialTheme.typography.bodySmall)
                // The same rows as a bill's bank lines.
                a.added.forEach { x ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(bankLineName(BankLine(x.description, x.amount)), style = MaterialTheme.typography.bodyMedium)
                            Text(x.card, color = l.faint, style = MaterialTheme.typography.labelMedium)
                        }
                        Text(money(x.amount), style = MaterialTheme.typography.bodyMedium)
                    }
                }
                // The lines landed on the bill's own month, which may not be the one on screen.
                val due = a.due?.take(7)
                if (a.read && a.added.isNotEmpty() && due != null && due != month) {
                    TextAction("Ver ${monthWord(due)}", { onPick(due) }, color = l.accent)
                }
            }
            s.failed?.let { Text(it, color = l.warn, style = MaterialTheme.typography.bodySmall) }
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
