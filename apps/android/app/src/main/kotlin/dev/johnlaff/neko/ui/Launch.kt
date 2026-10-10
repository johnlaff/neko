package dev.johnlaff.neko.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.MiaEntry
import dev.johnlaff.neko.data.QueueItem
import dev.johnlaff.neko.data.QueueLine
import dev.johnlaff.neko.data.SaldoView
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.ui.Format.fromCents
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.shortDate
import dev.johnlaff.neko.ui.Format.toCents
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * Para lançar and Lançar à mão (specs/005-lancamentos, Fase 2), as on the site (web/Launch.tsx).
 * The app sends back drafts the Worker built; it never decides a cell.
 */
interface Launcher {
    /** Reads the cells, then writes; the launch's id, for Desfazer. Throws with the reason. */
    suspend fun launch(draft: JsonObject, key: String?): String
    suspend fun undo(id: String): Boolean
    suspend fun ignore(key: String)
    suspend fun account(account: String, use: String)
    /** The Diário previsto on the days ahead at `value` per day; 0 takes it away. Its id, for Desfazer. */
    suspend fun previsto(value: Long): String
    suspend fun keepPrevisto()
    /** Lançar com a Mia; null while Mia is off or resting for the month. */
    val fill: (suspend (String, List<String>) -> MiaEntry?)? get() = null
}

/** How long Desfazer stays after a launch. */
private const val UNDO_MS = 10_000L

internal fun reasonOf(e: Throwable) =
    e.message?.takeIf { it.isNotBlank() }?.replaceFirstChar { it.uppercase() }
        ?: "Não gravou. Confira a conexão e tente de novo."

/** `2026-10-03` ↔ `03/10/2026`, the way a date is typed here. */
private fun typedDate(iso: String) = "${iso.substring(8, 10)}/${iso.substring(5, 7)}/${iso.take(4)}"

private fun isoDate(typed: String, year: String): String? {
    val m = Regex("""^(\d{1,2})/(\d{1,2})(?:/(\d{4}))?$""").find(typed.trim()) ?: return null
    val (d, mo, y) = m.destructured
    return runCatching {
        java.time.LocalDate.of((y.ifEmpty { year }).toInt(), mo.toInt(), d.toInt()).toString()
    }.getOrNull()
}

/**
 * "Diário de 15/10: R$ 0,00 → R$ 18,90", or "Economia de out: +R$ 500,00"; card parcels in later
 * bills are counted, not listed.
 */
@Composable
private fun Lines(lines: List<QueueLine>) {
    val l = LocalLedger.current
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        lines.take(2).forEach {
            val change = it.before?.let { b -> "${money(b)} → ${money(it.after)}" }
                ?: "${if (it.after < 0) "−" else "+"}${money(kotlin.math.abs(it.after))}"
            Text("${it.label}: $change", color = l.muted, style = MaterialTheme.typography.bodyMedium)
        }
        val more = lines.size - 2
        if (more > 0) Text(if (more == 1) "e mais 1 fatura" else "e mais $more faturas", color = l.muted, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
internal fun Small(text: String, filled: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(10.dp)
    val padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp)
    if (filled) Button(
        onClick, Modifier.heightIn(min = 44.dp), enabled = enabled, shape = shape, contentPadding = padding,
        // Dimmed when off, as the site's disabled buttons.
        colors = ButtonDefaults.buttonColors(
            containerColor = l.text,
            contentColor = l.bg,
            disabledContainerColor = l.text.copy(alpha = 0.5f),
            disabledContentColor = l.bg,
        ),
    ) { Text(text, color = l.bg, style = MaterialTheme.typography.labelLarge) }
    else OutlinedButton(
        onClick, Modifier.heightIn(min = 44.dp), enabled = enabled, shape = shape, contentPadding = padding,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = l.text),
        border = BorderStroke(1.dp, if (enabled) l.borderInput else l.borderInput.copy(alpha = 0.5f)),
    ) { Text(text, color = if (enabled) l.text else l.text.copy(alpha = 0.5f), style = MaterialTheme.typography.labelLarge) }
}

@Composable
internal fun Failed(text: String) {
    Text(
        text,
        color = LocalLedger.current.neg,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/**
 * Valor, como pagou and Lançar. With a draft (Ajustar, or the Saldo's difference) only value, day
 * and name change; by hand the owner also says how it was paid, and the parcels on a card.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EntryForm(
    launcher: Launcher,
    today: String,
    onClose: () -> Unit,
    onLaunched: (String) -> Unit,
    draft: JsonObject? = null,
    cards: List<String> = emptyList(),
    key: String? = null,
    startTyped: String = "",
) {
    val l = LocalLedger.current
    val scope = rememberCoroutineScope()
    fun field(name: String) = draft?.get(name)?.jsonPrimitive
    var typed by rememberSaveable { mutableStateOf(field("amount")?.longOrNull?.let(::fromCents) ?: startTyped) }
    var how by rememberSaveable { mutableStateOf("diario") }
    var count by rememberSaveable { mutableStateOf(1) }
    var name by rememberSaveable { mutableStateOf(field("description")?.content ?: "") }
    val start = field("date")?.content ?: today
    var date by rememberSaveable { mutableStateOf(typedDate(start)) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val amount = toCents(typed)?.takeIf { it > 0 }
    val iso = isoDate(date, start.take(4))
    val ok = amount != null && iso != null && name.isNotBlank()

    fun build(): JsonObject? {
        if (amount == null || iso == null || name.isBlank()) return null
        if (draft != null) return JsonObject(draft + mapOf(
            "amount" to JsonPrimitive(amount),
            "date" to JsonPrimitive(iso),
            "description" to JsonPrimitive(name.trim()),
        ))
        return buildJsonObject {
            put("type", "new")
            put("amount", amount)
            put("date", iso)
            put("description", name.trim())
            if (how.startsWith("card:")) {
                put("kind", "cartao")
                put("card", how.removePrefix("card:"))
                put("installments", count)
            } else put("kind", how)
        }
    }

    val colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = l.accent, unfocusedBorderColor = l.borderInput)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val fill = launcher.fill
        if (draft == null && fill != null) SaySentence(cards, fill) { e ->
            e.amount?.let { typed = fromCents(it) }
            if (e.kind == "cartao" && e.card != null) {
                how = "card:${e.card}"
                count = e.installments ?: 1
            } else e.kind?.let { how = it }
            e.date?.let { date = typedDate(it) }
            e.description?.let { name = it.take(80) }
        }
        OutlinedTextField(
            value = typed,
            onValueChange = { typed = it },
            label = { Text("Valor") },
            singleLine = true,
            prefix = { Text("R$ ", color = l.faint) },
            placeholder = { Text("0,00", color = l.faint) },
            textStyle = MaterialTheme.typography.headlineSmall,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Next),
            colors = colors,
            modifier = Modifier.fillMaxWidth(),
        )
        if (draft == null) {
            Text("Como pagou", color = l.muted, style = MaterialTheme.typography.labelLarge)
            val ways = listOf("diario" to "Pix ou débito", "entrada" to "Entrada", "conta" to "Conta") +
                cards.map { "card:$it" to it }
            FlowRow(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ways.forEach { (k, label) -> Choice(label, how == k) { how = k } }
            }
            if (how.startsWith("card:")) {
                FlowRow(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    (listOf(1, 2, 3, 6, 10, 12) + count).distinct().sorted().forEach { n -> Choice(if (n == 1) "À vista" else "$n×", count == n) { count = n } }
                }
            }
        }
        OutlinedTextField(
            value = name,
            onValueChange = { if (it.length <= 80) name = it },
            label = { Text("Nome") },
            placeholder = { Text("Padaria", color = l.faint) },
            singleLine = true,
            colors = colors,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = date,
            onValueChange = { date = it },
            label = { Text("Dia") },
            singleLine = true,
            isError = iso == null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
            colors = colors,
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Failed(it) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Small(if (busy) "Lançando…" else "Lançar", filled = true, enabled = ok && !busy) {
                val d = build() ?: return@Small
                busy = true
                error = null
                scope.launch {
                    runCatching { launcher.launch(d, key) }
                        .onSuccess { id ->
                            onLaunched(id)
                            onClose()
                        }
                        .onFailure { error = reasonOf(it) }
                    busy = false
                }
            }
            Small("Cancelar", filled = false, onClick = onClose)
        }
    }
}

/**
 * Lançar com a Mia (Fase 4), as on the site: one sentence fills the fields below; the owner checks
 * them and taps Lançar as always.
 */
@Composable
private fun SaySentence(cards: List<String>, fill: suspend (String, List<String>) -> MiaEntry?, onFill: (MiaEntry) -> Unit) {
    val l = LocalLedger.current
    val scope = rememberCoroutineScope()
    var frase by rememberSaveable { mutableStateOf("") }
    var said by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun send() {
        if (frase.isBlank() || busy) return
        busy = true
        said = null
        scope.launch {
            said = runCatching { fill(frase.trim(), cards) }.fold(
                { e ->
                    if (e != null) {
                        onFill(e)
                        "A Mia preencheu. Confira e lance."
                    } else "A Mia não entendeu. Diga o valor e como pagou."
                },
                { if ((it as? dev.johnlaff.neko.data.ApiException)?.status == 429) "A Mia usou o limite do mês e volta logo." else "A Mia não respondeu. Preencha abaixo." },
            )
            busy = false
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = frase,
                onValueChange = { if (it.length <= 300) frase = it },
                label = { Text("Numa frase") },
                placeholder = { Text("Padaria 12,50 no Pix", color = l.faint) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { send() }),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = l.accent, unfocusedBorderColor = l.borderInput),
                modifier = Modifier.weight(1f),
            )
            Small(if (busy) "Preenchendo…" else "Preencher", filled = false, enabled = frase.isNotBlank() && !busy) { send() }
        }
        said?.let {
            Text(it, color = l.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QueueRow(item: QueueItem, v: TodayView, launcher: Launcher?, onLaunched: (String) -> Unit) {
    val l = LocalLedger.current
    val scope = rememberCoroutineScope()
    var choice by rememberSaveable(item.key) { mutableStateOf(0) }
    var adjusting by rememberSaveable(item.key) { mutableStateOf(false) }
    var bank by rememberSaveable(item.key) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val option = item.options.getOrNull(choice) ?: item.options.firstOrNull()
    val draft = option?.draft
    val question = item.options.all { it.draft == null }
    val canWrite = v.writing && launcher != null
    val isCard = draft?.get("type")?.jsonPrimitive?.content == "card"

    fun run(block: suspend (Launcher) -> Unit) {
        val go = launcher ?: return
        busy = true
        error = null
        scope.launch {
            runCatching { block(go) }.onFailure { error = reasonOf(it) }
            busy = false
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(Format.bankText(item.title), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(shortDate(item.date), color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        if (item.options.size > 1 && !question) {
            FlowRow(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item.options.forEachIndexed { i, o -> Choice(o.label, choice == i) { choice = i } }
            }
        }
        option?.lines?.takeIf { it.isNotEmpty() }?.let { Lines(it) }
        item.note?.let { Text(it, color = l.muted, style = MaterialTheme.typography.bodyMedium) }
        if (adjusting && draft != null && launcher != null && !isCard) {
            EntryForm(launcher, v.today, { adjusting = false }, onLaunched, draft = draft, key = item.key)
        } else if (launcher != null) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (question) {
                    item.options.forEach { o ->
                        o.answer?.let { use ->
                            Small(o.label, filled = false, enabled = !busy) {
                                run { it.account(item.key.removePrefix("conta:"), use) }
                            }
                        }
                    }
                } else {
                    Small(if (busy) "Lançando…" else "Lançar", filled = true, enabled = canWrite && draft != null && !busy) {
                        val d = draft ?: return@Small
                        run { onLaunched(it.launch(d, item.key)) }
                    }
                    if (item.adjustable && !isCard)
                        Small("Ajustar", filled = false, enabled = canWrite && !busy) { adjusting = true }
                }
                Small("Ignorar", filled = false, enabled = !busy) { run { it.ignore(item.key) } }
            }
        }
        error?.let { Failed(it) }
        if (item.bank.isNotEmpty()) Column {
            TextAction("O banco mostrou", { bank = !bank }, open = bank)
            Reveal(bank) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    item.bank.forEach { m ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("${shortDate(m.date)} · ${Format.bankText(m.description)}", Modifier.weight(1f), color = l.muted, style = MaterialTheme.typography.bodySmall)
                            Text(
                                Format.signed(m.amount, if (m.amount > 0) '+' else '−'),
                                color = if (m.amount > 0) l.pos else l.muted,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** With nothing left to launch: yesterday's Saldo against the bank, and the difference to launch. */
@Composable
private fun Saldo(s: SaldoView, v: TodayView, launcher: Launcher?, onLaunched: (String) -> Unit) {
    val l = LocalLedger.current
    var fixing by rememberSaveable { mutableStateOf(false) }
    if (s.diff == 0L) {
        Text("Tudo lançado. O saldo bate com o banco.", color = l.pos)
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("Saldo de ${shortDate(s.date)}: ${money(s.sheet)} na planilha, ${money(s.bank)} no banco.", color = l.muted, style = MaterialTheme.typography.bodyMedium)
            Text("${if (s.diff > 0) "Faltam" else "Sobram"} ${money(kotlin.math.abs(s.diff))} na planilha.", color = l.muted, style = MaterialTheme.typography.bodyMedium)
        }
    }
    if (s.stale.isNotEmpty())
        Text("Sem atualizar hoje: ${s.stale.joinToString(", ")}. O saldo pode estar velho.", color = l.muted, style = MaterialTheme.typography.bodyMedium)
    val draft = s.draft
    if (draft != null && launcher != null && v.writing) {
        if (fixing) EntryForm(launcher, v.today, { fixing = false }, onLaunched, draft = draft)
        else Small("Lançar a diferença", filled = false) { fixing = true }
    }
}

/** Para lançar on Hoje: what the bank showed and the sheet does not have yet, one item a line. */
@Composable
fun ParaLancar(v: TodayView, launcher: Launcher?, onLaunched: (String) -> Unit) {
    val l = LocalLedger.current
    val items = v.queue ?: return
    val saldo = v.saldo
    if (items.isEmpty() && saldo == null) return
    Panel {
        PanelHead("Para lançar") {
            if (items.isNotEmpty()) Chip(if (items.size == 1) "1 item" else "${items.size} itens", ChipTone.Warn)
        }
        if (items.isEmpty() && saldo != null) Saldo(saldo, v, launcher, onLaunched)
        items.forEachIndexed { i, item ->
            if (i > 0) androidx.compose.foundation.layout.Box(Modifier.fillMaxWidth().padding(vertical = 2.dp).heightIn(min = 1.dp, max = 1.dp).background(l.border))
            androidx.compose.runtime.key(item.key) { QueueRow(item, v, launcher, onLaunched) }
        }
        if (!v.writing && items.isNotEmpty())
            Text("Para lançar daqui, ligue Lançar pelo Neko em Ajustes.", color = l.muted, style = MaterialTheme.typography.bodyMedium)
    }
}

/** Desfazer, over the dock, for a few seconds after each launch. */
@Composable
fun UndoBar(
    entryId: String?,
    launcher: Launcher?,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    done: String = "Lançado na planilha",
) {
    val l = LocalLedger.current
    val scope = rememberCoroutineScope()
    var text by remember(entryId) { mutableStateOf(if (entryId != null) done else null) }
    var busy by remember(entryId) { mutableStateOf(false) }
    var id by remember(entryId) { mutableStateOf(entryId) }
    LaunchedEffect(entryId, text, busy) {
        if (text == null || busy) return@LaunchedEffect
        delay(UNDO_MS)
        onDone()
    }
    val shown = text ?: return
    Row(
        modifier
            .fillMaxWidth()
            .background(l.text, RoundedCornerShape(12.dp))
            .padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 4.dp)
            .semantics { liveRegion = LiveRegionMode.Polite },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(shown, Modifier.weight(1f), color = l.bg, style = MaterialTheme.typography.bodyMedium)
        val undoing = id
        if (undoing != null && launcher != null) {
            TextAction(if (busy) "Desfazendo…" else "Desfazer", {
                if (!busy) {
                    busy = true
                    scope.launch {
                        text = runCatching { launcher.undo(undoing) }.fold(
                            { if (it) "Desfeito" else "A planilha mudou depois. Desfaça por lá" },
                            ::reasonOf,
                        )
                        id = null
                        busy = false
                    }
                }
            }, l.bg)
        }
    }
}
