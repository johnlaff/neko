package dev.johnlaff.neko.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.ApiException
import dev.johnlaff.neko.data.MiaEntry
import dev.johnlaff.neko.data.QueueItem
import dev.johnlaff.neko.data.QueueLine
import dev.johnlaff.neko.data.SaldoView
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.ui.Format.fromCents
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.shortDate
import dev.johnlaff.neko.ui.Format.toCents
import kotlinx.coroutines.CancellationException
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
    /** Writes in one request, refusing a line that changed; the launch's id, for Desfazer. */
    suspend fun launch(draft: JsonObject, key: String?): String
    /** Atualizar agora: the banks read now; false when one did not answer. */
    suspend fun refreshBanks(): Boolean = false
    suspend fun undo(id: String): Boolean
    suspend fun ignore(key: String)
    suspend fun account(account: String, use: String)
    /** The Diário previsto on the days ahead at `value` per day; 0 takes it away. Its id, for Desfazer. */
    suspend fun previsto(value: Long): String
    suspend fun keepPrevisto()
    /** Lançar com a Mia; null while Mia is off or resting for the month. */
    val fill: (suspend (String, List<String>) -> MiaEntry?)? get() = null
}

/** An undo id for Ignorar: Desfazer brings the item back instead of undoing a launch. */
const val IGNORED = "ignored:"

/** How long Desfazer stays after a launch. */
private const val UNDO_MS = 10_000L

/** Worker refusals whose message is written for the owner; any other text stays out of sight. */
private val SPOKEN = setOf("busy", "write", "writing-off", "sheet-structure")

/**
 * Why an action failed, in Portuguese the owner can act on: the Worker's own words when it
 * refused, and plain advice when the connection dropped (the same tap again writes once).
 */
internal fun reasonOf(e: Throwable): String = when {
    e is ApiException && e.code in SPOKEN && !e.message.isNullOrBlank() ->
        e.message!!.replaceFirstChar { it.uppercase() }
    e is ApiException -> "O Neko não conseguiu agora. Tente de novo daqui a pouco."
    else -> "A conexão caiu antes da resposta. Toque de novo: nada é gravado duas vezes."
}

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
 * One change, read like a ledger line (web Change): where and the new value on top, what it was
 * and by how much it moves under them.
 */
@Composable
private fun Change(line: QueueLine) {
    val l = LocalLedger.current
    val sign = { c: Long -> Format.signed(c, if (c < 0) '−' else '+') }
    val before = line.before
    val where = Format.bankText(line.label)
    val value = if (line.change == "economia") sign(line.after) else money(line.after)
    val was = when {
        line.change == "economia" -> "na aba Economia"
        before == null -> "linha nova"
        else -> "era ${money(before)}"
    }
    val diff = line.diff?.takeIf { it != 0L }?.let(sign)
    // With large text the value goes under the place instead of squeezing it (web @container).
    if (LocalDensity.current.fontScale >= 1.5f) {
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(where, color = l.text, style = MaterialTheme.typography.bodyMedium)
            Text(value, color = l.text, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
            Text(listOfNotNull(was, diff).joinToString(" · "), color = l.muted, style = MaterialTheme.typography.bodySmall)
        }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(where, Modifier.weight(1f), color = l.text, style = MaterialTheme.typography.bodyMedium)
            Text(value, color = l.text, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(was, Modifier.weight(1f), color = l.muted, style = MaterialTheme.typography.bodySmall)
            diff?.let { Text(it, color = l.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1) }
        }
    }
}

/** What Lançar writes in the sheet, line by line; past the first three, behind a tap. */
@Composable
private fun Impact(lines: List<QueueLine>, key: String) {
    val l = LocalLedger.current
    var all by rememberSaveable(key) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().background(l.text.copy(alpha = 0.08f), RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Na planilha", color = l.faint, style = MaterialTheme.typography.labelMedium)
        lines.take(3).forEach { Change(it) }
        val rest = lines.drop(3)
        if (rest.isNotEmpty()) {
            TextAction(if (rest.size == 1) "Mais 1 mudança" else "Mais ${rest.size} mudanças", { all = !all }, open = all)
            Reveal(all) { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { rest.forEach { Change(it) } } }
        }
    }
}

@Composable
internal fun Small(text: String, filled: Boolean, enabled: Boolean = true, modifier: Modifier = Modifier, spinning: Boolean = false, onClick: () -> Unit) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(10.dp)
    val padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp)
    if (filled) Button(
        onClick, modifier.heightIn(min = 44.dp), enabled = enabled, shape = shape, contentPadding = padding,
        // Dimmed when off, as the site's disabled buttons.
        colors = ButtonDefaults.buttonColors(
            containerColor = l.text,
            contentColor = l.bg,
            disabledContainerColor = l.text.copy(alpha = 0.5f),
            disabledContentColor = l.bg,
        ),
    ) {
        if (spinning) CircularProgressIndicator(Modifier.padding(end = 8.dp).size(14.dp), color = l.bg, strokeWidth = 2.dp)
        Text(text, color = l.bg, style = MaterialTheme.typography.labelLarge)
    }
    else OutlinedButton(
        onClick, modifier.heightIn(min = 44.dp), enabled = enabled, shape = shape, contentPadding = padding,
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
    // A sentence that left the way of paying open asks the owner to pick one.
    val ok = amount != null && iso != null && name.isNotBlank() && (draft != null || how.isNotEmpty())

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
        // A new sentence replaces every field, so nothing from the last one stays behind.
        if (draft == null && fill != null) SaySentence(cards, fill) { e ->
            typed = e.amount?.let(::fromCents) ?: ""
            how = if (e.kind == "cartao" && e.card != null) "card:${e.card}" else e.kind ?: ""
            count = if (e.kind == "cartao") e.installments ?: 1 else 1
            date = typedDate(e.date ?: today)
            name = e.description?.take(80) ?: ""
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
    val focus = LocalFocusManager.current
    val sentence = remember { FocusRequester() }
    var said by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    // With Mia on, the sentence is what the form opens for.
    LaunchedEffect(Unit) { runCatching { sentence.requestFocus() } }

    fun send() {
        if (frase.isBlank() || busy) return
        busy = true
        said = ""
        scope.launch {
            said = try {
                val e = fill(frase.trim(), cards)
                if (e == null) "A Mia não entendeu. Diga o valor e como pagou."
                else {
                    onFill(e)
                    // The keyboard closes, so the filled fields and Lançar show.
                    focus.clearFocus()
                    // The line names what is still missing, so Lançar off is never a puzzle.
                    when {
                        e.amount == null -> "A Mia preencheu. Diga o valor e lance."
                        e.kind == null -> "A Mia preencheu. Escolha como pagou e lance."
                        e.description == null -> "A Mia preencheu. Dê um nome e lance."
                        else -> "A Mia preencheu. Confira e lance."
                    }
                }
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                if ((t as? ApiException)?.status == 429) "A Mia descansa até o mês que vem. Preencha abaixo."
                else "A Mia não respondeu. Preencha abaixo."
            } finally {
                busy = false
            }
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
                modifier = Modifier.weight(1f).focusRequester(sentence),
            )
            // A fixed width, so the sentence field does not jump while Mia works.
            Small(if (busy) "Preenchendo…" else "Preencher", filled = false, enabled = frase.isNotBlank() && !busy, modifier = Modifier.widthIn(min = 136.dp)) { send() }
        }
        // Always there, so the screen reader hears each new line.
        Box(Modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }) {
            if (said.isNotEmpty()) Text(said, color = l.muted, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QueueRow(item: QueueItem, v: TodayView, launcher: Launcher?, onLaunched: (String) -> Unit, onGone: () -> Unit) {
    val l = LocalLedger.current
    val scope = rememberCoroutineScope()
    var choice by rememberSaveable(item.key) { mutableStateOf(0) }
    var adjusting by rememberSaveable(item.key) { mutableStateOf(false) }
    var details by rememberSaveable(item.key) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var launching by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val option = item.options.getOrNull(choice) ?: item.options.firstOrNull()
    val draft = option?.draft
    val lines = option?.lines.orEmpty()
    val question = item.options.all { it.draft == null }
    val canWrite = v.writing && launcher != null
    val isCard = draft?.get("type")?.jsonPrimitive?.content == "card"

    // Done: the item folds away (ParaLancar animates it) while Hoje reads again behind it.
    fun run(block: suspend (Launcher) -> Unit) {
        val go = launcher ?: return
        busy = true
        error = null
        scope.launch {
            runCatching { block(go) }
                .onSuccess { onGone() }
                .onFailure { error = reasonOf(it); busy = false; launching = false }
        }
    }

    // While writing, the item dims and locks; the button saying "Lançando…" stays readable.
    val dim = Modifier.graphicsLayer { alpha = if (busy) 0.6f else 1f }
    Column(
        Modifier.fillMaxWidth().padding(vertical = 6.dp).semantics { if (busy) stateDescription = "Gravando" },
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth().then(dim), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(Format.bankText(item.title), Modifier.weight(1f), color = l.text, style = MaterialTheme.typography.titleSmall)
            Text(shortDate(item.date), color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        item.note?.let { Text(it, dim, color = l.muted, style = MaterialTheme.typography.bodyMedium) }
        if (item.options.size > 1 && !question) {
            FlowRow(Modifier.selectableGroup().then(dim), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item.options.forEachIndexed { i, o -> Choice(o.label, choice == i) { if (!busy) choice = i } }
            }
        }
        if (lines.isNotEmpty()) Box(dim) { Impact(lines, "${item.key}|$choice") }
        if (adjusting && draft != null && launcher != null && !isCard) {
            EntryForm(launcher, v.today, { adjusting = false }, { id -> onLaunched(id); onGone() }, draft = draft, key = item.key)
        } else if (launcher != null) {
            // Ignorar closes the action row: the way out, quiet, at the far end, with Desfazer.
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (question) {
                        item.options.forEach { o ->
                            o.answer?.let { use ->
                                Small(o.label, filled = false, enabled = !busy) {
                                    run { it.account(item.key.removePrefix("conta:"), use) }
                                }
                            }
                        }
                    } else {
                        Small(if (launching) "Lançando…" else "Lançar", filled = true, enabled = canWrite && draft != null && (!busy || launching), spinning = launching) {
                            if (busy) return@Small
                            val d = draft ?: return@Small
                            launching = true
                            run { onLaunched(it.launch(d, item.key)) }
                        }
                        if (item.adjustable && !isCard)
                            Small("Ajustar", filled = false, enabled = canWrite && !busy) { adjusting = true }
                    }
                }
                TextAction("Ignorar", {
                    if (!busy) run {
                        it.ignore(item.key)
                        onLaunched("$IGNORED${item.key}")
                    }
                }, l.muted)
            }
        }
        error?.let { Failed(it) }
        // The day's whole cell and what the bank showed: there to check, closed (web Details).
        val cells = lines.mapNotNull { it.cell }
        if (cells.isNotEmpty() || item.bank.isNotEmpty()) Column(dim) {
            TextAction("Detalhes", { details = !details }, open = details)
            Reveal(details) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    cells.forEach { c ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(c.label, Modifier.weight(1f), color = l.muted, style = MaterialTheme.typography.bodySmall)
                            Text("${money(c.before)} → ${money(c.after)}", color = l.muted, style = MaterialTheme.typography.bodySmall)
                        }
                    }
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

/** When the banks were last read, and Atualizar agora to read them without waiting for the morning. */
@Composable
private fun Refresh(syncedAt: String?, launcher: Launcher?) {
    val l = LocalLedger.current
    val scope = rememberCoroutineScope()
    var reading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            when {
                reading -> "Lendo os bancos…"
                failed -> "Algum banco não respondeu. Tente de novo mais tarde."
                syncedAt != null -> "Bancos lidos ${readAtText(syncedAt)}."
                else -> "Bancos ainda não lidos."
            },
            Modifier.weight(1f), color = l.muted, style = MaterialTheme.typography.bodySmall,
        )
        if (launcher != null) TextAction("Atualizar agora", {
            if (!reading) {
                reading = true
                scope.launch {
                    failed = !runCatching { launcher.refreshBanks() }.getOrDefault(false)
                    reading = false
                }
            }
        })
    }
}

/** Para lançar on Hoje: what the bank showed and the sheet does not have yet, one item a line. */
@Composable
fun ParaLancar(v: TodayView, launcher: Launcher?, onLaunched: (String) -> Unit) {
    val l = LocalLedger.current
    val items = v.queue ?: return
    val saldo = v.saldo
    // Gone until the next read of Hoje, which leaves out what was done and brings back what was undone.
    var gone by remember(items) { mutableStateOf(emptySet<String>()) }
    val left = items.filter { it.key !in gone }
    if (items.isEmpty() && saldo == null) return
    Panel {
        PanelHead("Para lançar") {
            if (left.isNotEmpty()) Chip(if (left.size == 1) "1 item" else "${left.size} itens", ChipTone.Plain)
        }
        Column {
            Text("Nada muda na planilha até você tocar em Lançar.", color = l.muted, style = MaterialTheme.typography.bodySmall)
            Refresh(v.bankSyncedAt, launcher)
        }
        if (left.isEmpty() && saldo != null) Saldo(saldo, v, launcher, onLaunched)
        items.forEachIndexed { i, item ->
            androidx.compose.runtime.key(item.key) {
                // Folds away when done, so the next item slides up into place (web .q-item.leaving).
                AnimatedVisibility(
                    item.key !in gone,
                    enter = EnterTransition.None,
                    exit = fadeOut(tween(160)) + shrinkVertically(tween(240, 40, Motion.Enter)),
                ) {
                    Column {
                        if (i > 0) androidx.compose.foundation.layout.Box(Modifier.fillMaxWidth().padding(vertical = 2.dp).heightIn(min = 1.dp, max = 1.dp).background(l.border))
                        QueueRow(item, v, launcher, onLaunched) { gone = gone + item.key }
                    }
                }
            }
        }
        if (!v.writing && left.isNotEmpty())
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
