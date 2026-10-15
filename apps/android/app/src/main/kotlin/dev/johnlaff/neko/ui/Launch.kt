package dev.johnlaff.neko.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.layout
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import dev.johnlaff.neko.R
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.ApiException
import dev.johnlaff.neko.data.BankLine
import dev.johnlaff.neko.data.BillPurchases
import dev.johnlaff.neko.data.MiaEntry
import dev.johnlaff.neko.data.IgnoredItem
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
    e is ApiException -> "Algo falhou no Neko. Tente de novo daqui a pouco."
    else -> "A conexão caiu. Tente de novo: nada é gravado duas vezes."
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
private fun Change(line: QueueLine, allNew: Boolean) {
    val l = LocalLedger.current
    val sign = { c: Long -> Format.signed(c, if (c < 0) '−' else '+') }
    val before = line.before
    val where = Format.bankText(line.label)
    val value = if (line.change == "economia") sign(line.after) else money(line.after)
    // When every line is new the box's head says so once; each line then needs no "Linha nova" (as on the site).
    val was = when {
        line.change == "economia" -> "na aba Economia"
        before == null -> if (allNew) null else "Linha nova"
        else -> "era ${money(before)}"
    }
    val diff = line.diff?.takeIf { it != 0L }?.let(sign)
    // With large text the value goes under the place instead of squeezing it (web @container).
    if (LocalDensity.current.fontScale >= 1.5f) {
        Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(where, color = l.text, style = MaterialTheme.typography.bodyMedium)
            Text(value, color = l.text, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
            if (was != null || diff != null) Text(listOfNotNull(was, diff).joinToString(" · "), color = l.muted, style = MaterialTheme.typography.bodySmall)
        }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(where, Modifier.weight(1f), color = l.text, style = MaterialTheme.typography.bodyMedium)
            Text(value, color = l.text, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
        }
        if (was != null || diff != null) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(was.orEmpty(), Modifier.weight(1f), color = l.muted, style = MaterialTheme.typography.bodySmall)
            diff?.let { Text(it, color = l.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1) }
        }
    }
}

/** `15 out · 1/3`: when, and which parcel when it is one (web purchaseWhen). */
private fun purchaseWhen(p: BankLine): String = listOfNotNull(
    p.date?.let(::shortDate),
    if (p.installment != null && p.installments != null) "${p.installment}/${p.installments}" else null,
).joinToString(" · ")

@Composable
private fun Purchase(p: BankLine) {
    val l = LocalLedger.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        // One line a purchase: the name, its day beside it in a quieter tone (web .q-buys).
        val name = bankLineName(p)
        val day = purchaseWhen(p)
        Text(
            androidx.compose.ui.text.buildAnnotatedString {
                append(name)
                if (day.isNotEmpty()) {
                    append("  ")
                    withStyle(androidx.compose.ui.text.SpanStyle(color = l.faint, fontSize = MaterialTheme.typography.labelMedium.fontSize)) { append(day.replace(' ', '\u00a0')) }
                }
            },
            Modifier.weight(1f), color = l.text, style = MaterialTheme.typography.bodyMedium,
        )
        Text(money(p.amount), color = if (p.amount < 0) l.pos else l.text, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
    }
}

/**
 * Why a bill goes up, as the bank lists it: the purchases that add up to the change, newest
 * first, like a bank app's bill. Past the first three, behind a tap (web Purchases).
 */
@Composable
private fun Purchases(groups: List<BillPurchases>, key: String) {
    val l = LocalLedger.current
    var all by rememberSaveable(key) { mutableStateOf(false) }
    fun head(g: BillPurchases) = when {
        !g.exact -> "Últimas no banco"
        groups.size == 1 -> "Compras novas · ${money(g.total)}"
        else -> "Compras novas · ${money(g.total)} na fatura de ${shortDate(g.due)}"
    }
    // The first three purchases in sight, the rest of each bill behind one tap.
    var left = 3
    val split = groups.map { g ->
        val shown = g.lines.take(left)
        left -= shown.size
        Triple(g, shown, g.lines.drop(shown.size))
    }
    val hidden = split.sumOf { it.third.size }
    val block: @Composable (BillPurchases, List<BankLine>, Boolean) -> Unit = { g, rows, titled ->
        if (rows.isNotEmpty()) {
            if (titled) Text(head(g), color = l.muted, style = MaterialTheme.typography.labelMedium)
            rows.forEach { Purchase(it) }
        }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        split.forEach { (g, shown, _) -> block(g, shown, true) }
        if (hidden > 0) {
            TextAction(if (hidden == 1) "Mais 1 compra" else "Mais $hidden compras", { all = !all }, open = all)
            Reveal(all) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    split.forEach { (g, shown, rest) -> block(g, rest, shown.isEmpty()) }
                }
            }
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
        val allNew = lines.all { it.before == null && it.change != "economia" }
        Text(
            when {
                !allNew -> "Na planilha"
                lines.size == 1 -> "Linha nova na planilha"
                else -> "${lines.size} linhas novas na planilha"
            },
            color = l.faint, style = MaterialTheme.typography.labelMedium,
        )
        lines.take(3).forEach { Change(it, allNew) }
        val rest = lines.drop(3)
        if (rest.isNotEmpty()) {
            TextAction(if (rest.size == 1) "Mais 1 mudança" else "Mais ${rest.size} mudanças", { all = !all }, open = all)
            Reveal(all) { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { rest.forEach { Change(it, allNew) } } }
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
        Text(text, color = l.bg, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
    }
    else OutlinedButton(
        onClick, modifier.heightIn(min = 44.dp), enabled = enabled, shape = shape, contentPadding = padding,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = l.text),
        border = BorderStroke(1.dp, if (enabled) l.borderInput else l.borderInput.copy(alpha = 0.5f)),
    ) { Text(text, color = if (enabled) l.text else l.text.copy(alpha = 0.5f), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge) }
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
 * Valor, tipo and Lançar. With a draft (Ajustar, or the Saldo's difference) only value, day
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
    // What still keeps Lançar off, said beside it; and a day outside this month, said before it goes (as on the site).
    val missing = when {
        amount == null -> if (typed.isBlank()) "Falta o valor" else "Escreva o valor como 42,50"
        name.isBlank() -> "Falta o nome"
        draft == null && how.isEmpty() -> "Escolha o tipo"
        iso == null -> "Falta o dia"
        else -> null
    }
    val away = when {
        missing != null || iso == null -> null
        iso > today -> "Vai para ${shortDate(iso)}, um dia que ainda não chegou"
        iso.take(7) != today.take(7) -> "Vai para ${shortDate(iso)}, fora deste mês"
        else -> null
    }

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
            Text("Tipo", color = l.muted, style = MaterialTheme.typography.labelLarge)
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
        (missing ?: away)?.let {
            Text(it, color = l.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        }
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
                if (e == null) "A Mia não entendeu. Diga o valor e o tipo."
                else {
                    onFill(e)
                    // The keyboard closes, so the filled fields and Lançar show.
                    focus.clearFocus()
                    // The line names what is still missing, so Lançar off is never a puzzle.
                    when {
                        e.amount == null -> "A Mia preencheu. Diga o valor e lance."
                        e.kind == null -> "A Mia preencheu. Escolha o tipo e lance."
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
/** A stroke icon from an SVG path on a 24px grid, drawn like the site's icons (web/icons.tsx). */
private fun stroke(name: String, path: String): ImageVector =
    ImageVector.Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        .addPath(
            pathData = PathParser().parsePathString(path).toNodes(),
            fill = null,
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 1.75f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
        .build()

private val TodayIcon = stroke("today", "M6.5 5h11a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM3.5 10h17M8 3v4M16 3v4M12 14.25a0.75 0.75 0 1 1 0 1.5a0.75 0.75 0 1 1 0-1.5")
private val CheckIcon = stroke("check", "m5 12.5 4.5 4.5L19 7.5")
private val RefreshIcon = stroke("refresh", "M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5")
private val PrevIcon = stroke("prev", "m15 6-6 6 6 6")
private val NextIcon = stroke("next", "m9 6 6 6-6 6")

/** The item's mark: what it is about when the name says it, else what kind of line it makes (web Mark). */
@Composable
private fun Mark(item: QueueItem) {
    val l = LocalLedger.current
    val tint = l.muted
    Box(Modifier.size(32.dp).background(l.surface2, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
        val vector = when (item.kind) {
            "previsto" -> TodayIcon
            "cartao" -> null
            else -> categoryIcon(item.title)
        }
        if (vector != null) Icon(vector, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        else Icon(
            painterResource(
                when (item.kind) {
                    "cartao" -> R.drawable.ic_card
                    "entrada", "resgate" -> R.drawable.ic_income
                    "conta-propria", "guardar" -> R.drawable.ic_repeat
                    else -> R.drawable.ic_receipt
                },
            ),
            contentDescription = null, tint = tint, modifier = Modifier.size(16.dp),
        )
    }
}

/** A choice between whole launches: one track, the picked one lit (web fieldset.q-choice). */
@Composable
private fun Segments(labels: List<String>, picked: Int, enabled: Boolean, onPick: (Int) -> Unit) {
    val l = LocalLedger.current
    Row(
        Modifier.fillMaxWidth().background(l.text.copy(alpha = 0.08f), RoundedCornerShape(12.dp)).padding(3.dp).selectableGroup(),
    ) {
        labels.forEachIndexed { i, label ->
            val on = i == picked
            val bg by animateColorAsState(if (on) l.text else Color.Transparent, tween(160), label = "segment")
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = 40.dp)
                    .background(bg, RoundedCornerShape(9.dp))
                    .selectable(on, enabled = enabled, role = Role.RadioButton) { onPick(i) }
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    color = if (on) l.bg else l.muted,
                    fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
                    style = MaterialTheme.typography.labelLarge,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

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

    // Done: the item slides off the deck (ParaLancar animates it) while Hoje reads again behind it.
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
        Modifier.fillMaxWidth().semantics { if (busy) stateDescription = "Gravando" },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(Modifier.fillMaxWidth().then(dim), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Mark(item)
            Text(Format.bankText(item.title), Modifier.weight(1f), color = l.text, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
            Text(shortDate(item.date), color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        item.note?.takeIf { it.isNotBlank() }?.let { Text(it, dim, color = l.muted, style = MaterialTheme.typography.bodyMedium) }
        if (item.purchases.isNotEmpty()) Box(dim) { Purchases(item.purchases, item.key) }
        if (item.options.size > 1 && !question) Box(dim.semantics { contentDescription = "O que lançar" }) {
            Segments(item.options.map { it.label }, choice, enabled = !busy) { choice = it }
        }
        if (lines.isNotEmpty()) Box(dim) { Impact(lines, "${item.key}|$choice") }
        if (adjusting && draft != null && launcher != null && !isCard) {
            EntryForm(launcher, v.today, { adjusting = false }, { id -> onLaunched(id); onGone() }, draft = draft, key = item.key)
        } else if (launcher != null) {
            // Lançar fills the row; Ajustar stays beside it, and a question's two answers share it.
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (question) {
                    item.options.forEach { o ->
                        o.answer?.let { use ->
                            Small(o.label, filled = false, enabled = !busy, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                                run { it.account(item.key.removePrefix("conta:"), use) }
                            }
                        }
                    }
                } else {
                    Small(
                        if (launching) "Lançando…" else "Lançar", filled = true,
                        enabled = canWrite && draft != null && (!busy || launching), spinning = launching,
                        modifier = Modifier.weight(2f).heightIn(min = 48.dp),
                    ) {
                        if (busy) return@Small
                        val d = draft ?: return@Small
                        launching = true
                        run { onLaunched(it.launch(d, item.key)) }
                    }
                    if (item.adjustable && !isCard)
                        Small("Ajustar", filled = false, enabled = canWrite && !busy, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { adjusting = true }
                }
            }
        }
        error?.let { Failed(it) }
        // Detalhes to check, Ignorar to leave: both quiet, under the answer (web .q-foot).
        val cells = lines.mapNotNull { it.cell }
        val hasDetails = cells.isNotEmpty() || item.bank.isNotEmpty()
        Column(dim) {
            Row(Modifier.fillMaxWidth().padding(top = 0.dp), verticalAlignment = Alignment.CenterVertically) {
                if (hasDetails) TextAction("Detalhes", { details = !details }, l.faint, open = details, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.weight(1f))
                if (launcher != null) TextAction("Ignorar", {
                    if (!busy) run {
                        it.ignore(item.key)
                        onLaunched("$IGNORED${item.key}")
                    }
                }, l.faint, style = MaterialTheme.typography.bodySmall)
            }
            if (hasDetails) Reveal(details) {
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

/** With nothing left to launch: yesterday's Saldo, the sheet's beside the bank's, and the gap (web Saldo). */
@Composable
private fun Saldo(s: SaldoView, v: TodayView, launcher: Launcher?, onLaunched: (String) -> Unit) {
    val l = LocalLedger.current
    var fixing by rememberSaveable { mutableStateOf(false) }
    val even = s.diff == 0L
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (even) Icon(CheckIcon, contentDescription = null, tint = l.pos, modifier = Modifier.size(22.dp))
            Text(
                if (even) "Tudo lançado" else "${if (s.diff > 0) "Faltam" else "Sobram"} ${money(kotlin.math.abs(s.diff))} na planilha",
                color = if (even) l.pos else l.warn,
                style = MaterialTheme.typography.headlineSmall,
            )
        }
        val shape = RoundedCornerShape(10.dp)
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).border(1.dp, l.border, shape)) {
            listOf("Planilha" to s.sheet, "Banco" to s.bank).forEachIndexed { i, (label, value) ->
                if (i > 0) Box(Modifier.width(1.dp).fillMaxHeight().background(l.border))
                Column(Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(label, color = l.muted, style = MaterialTheme.typography.labelMedium)
                    Text(money(value), color = l.text, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
        Text("Conferido até o fim de ${shortDate(s.date)}${if (even) ": bate com o banco." else "."}", color = l.muted, style = MaterialTheme.typography.bodySmall)
        if (s.stale.isNotEmpty())
            Text("Sem atualizar hoje: ${s.stale.joinToString(", ")}. O saldo pode estar velho.", color = l.muted, style = MaterialTheme.typography.bodyMedium)
        val draft = s.draft
        if (draft != null && launcher != null && v.writing) {
            if (fixing) EntryForm(launcher, v.today, { fixing = false }, onLaunched, draft = draft)
            else Small("Lançar a diferença", filled = false, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { fixing = true }
        }
    }
}

/** When the banks were last read, and Atualizar to read them without waiting for the morning. */
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
                failed -> "Algum banco não respondeu. Tente mais tarde."
                syncedAt != null -> "Bancos lidos ${readAtText(syncedAt)}"
                else -> "Bancos ainda não lidos"
            },
            Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite }, color = l.faint, style = MaterialTheme.typography.bodySmall,
        )
        if (launcher != null) Row(
            Modifier
                .clickable(enabled = !reading, role = Role.Button) {
                    reading = true
                    scope.launch {
                        failed = !runCatching { launcher.refreshBanks() }.getOrDefault(false)
                        reading = false
                    }
                }
                .heightIn(min = 44.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(RefreshIcon, contentDescription = null, tint = l.muted, modifier = Modifier.size(14.dp))
            Text("Atualizar", color = l.muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** A line across the whole panel, through its padding (web .q-tail's border). */
private fun Modifier.bleed(by: androidx.compose.ui.unit.Dp) = layout { m, c ->
    val extra = by.roundToPx() * 2
    val p = m.measure(c.copy(minWidth = c.maxWidth + extra, maxWidth = c.maxWidth + extra))
    layout(c.maxWidth, p.height) { p.place(-extra / 2, 0) }
}

/**
 * Para lançar on Hoje: a deck, one item at a time (web ParaLancar). The bar under the title fills
 * as items are answered, and the edges under the card say more are waiting.
 */
@Composable
fun ParaLancar(v: TodayView, launcher: Launcher?, onLaunched: (String) -> Unit) {
    val l = LocalLedger.current
    val items = v.queue ?: return
    val saldo = v.saldo
    // Gone until the next read of Hoje, which leaves out what was done and brings back what was undone.
    var gone by remember(items) { mutableStateOf(emptySet<String>()) }
    val left = items.filter { it.key !in gone }
    if (items.isEmpty() && saldo == null) return
    var at by rememberSaveable { mutableStateOf(0) }
    var back by remember { mutableStateOf(false) }
    val index = at.coerceIn(0, (left.size - 1).coerceAtLeast(0))
    val item = left.getOrNull(index)
    val total = left.size + gone.size
    val under = (left.size - 1 - index).coerceIn(0, 2)
    fun go(to: Int) {
        back = to < index
        at = to
    }
    Box(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        // The edges of the cards waiting, under the one in front.
        val shape = RoundedCornerShape(12.dp)
        listOf(2 to 22.dp, 1 to 10.dp).forEach { (n, inset) ->
            val shown by animateFloatAsState(if (under >= n) 1f else 0f, tween(200), label = "edge$n")
            Box(
                Modifier.matchParentSize()
                    .padding(horizontal = inset)
                    .graphicsLayer { translationY = (if (n == 2) 13.dp else 7.dp).toPx() * shown; alpha = shown }
                    .background(if (n == 2) l.surface.copy(alpha = 0.7f).compositeOver(l.bg) else l.surface, shape)
                    .border(1.dp, l.border, shape),
            )
        }
        Panel {
            PanelHead("Para lançar") {
                if (total > 1 && left.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { go(index - 1) }, enabled = index > 0) {
                        Icon(PrevIcon, contentDescription = "Anterior", tint = l.muted.copy(alpha = if (index > 0) 1f else 0.35f), modifier = Modifier.size(18.dp))
                    }
                    Text(
                        "${gone.size + index + 1} de $total",
                        Modifier.widthIn(min = 44.dp).semantics { liveRegion = LiveRegionMode.Polite },
                        color = l.muted, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center,
                    )
                    IconButton(onClick = { go(index + 1) }, enabled = index < left.size - 1) {
                        Icon(NextIcon, contentDescription = "Próximo", tint = l.muted.copy(alpha = if (index < left.size - 1) 1f else 0.35f), modifier = Modifier.size(18.dp))
                    }
                }
            }
            if (total > 1) Row(Modifier.fillMaxWidth().padding(bottom = 2.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                repeat(total) { i ->
                    val color by animateColorAsState(
                        when {
                            i < gone.size -> l.accent
                            item != null && i == gone.size + index -> l.muted
                            else -> l.border
                        },
                        tween(300), label = "segment",
                    )
                    Box(Modifier.weight(1f).height(3.dp).background(color, RoundedCornerShape(2.dp)))
                }
            }
            if (item == null) {
                if (saldo != null) Saldo(saldo, v, launcher, onLaunched)
            } else AnimatedContent(
                // A swipe sideways goes to the next or the previous item, like the arrows.
                modifier = Modifier.pointerInput(index, left.size) {
                    var dx = 0f
                    detectHorizontalDragGestures(
                        onDragStart = { dx = 0f },
                        onDragEnd = {
                            val far = 64.dp.toPx()
                            if (dx < -far && index < left.size - 1) go(index + 1)
                            else if (dx > far && index > 0) go(index - 1)
                        },
                    ) { _, amount -> dx += amount }
                },
                targetState = item,
                contentKey = { it.key },
                transitionSpec = {
                    val from = if (back) -1 else 1
                    (slideInHorizontally(tween(280, easing = Motion.Enter)) { from * it / 12 } + fadeIn(tween(280)))
                        .togetherWith(slideOutHorizontally(tween(200)) { -from * it / 12 } + fadeOut(tween(200)))
                        .using(SizeTransform(clip = false))
                },
                label = "deck",
            ) { shown ->
                QueueRow(shown, v, launcher, onLaunched) {
                    back = false
                    gone = gone + shown.key
                }
            }
            if (!v.writing && left.isNotEmpty())
                Text("Para lançar daqui, ligue Lançar pelo Neko em Ajustes.", color = l.muted, style = MaterialTheme.typography.bodyMedium)
            Column {
                Box(Modifier.bleed(16.dp).height(1.dp).background(l.border))
                Refresh(v.bankSyncedAt, launcher)
                if (launcher != null) Ignored(v.ignored, launcher)
            }
        }
    }
}

/** What Ignorar set aside, behind a tap: any of it comes back after Desfazer is gone (as on the site). */
@Composable
private fun androidx.compose.foundation.layout.ColumnScope.Ignored(items: List<IgnoredItem>, launcher: Launcher) {
    if (items.isEmpty()) return
    val l = LocalLedger.current
    val scope = rememberCoroutineScope()
    var open by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    TextAction(if (items.size == 1) "1 ignorado" else "${items.size} ignorados", { open = !open }, l.faint, open = open, style = MaterialTheme.typography.bodySmall)
    Reveal(open) {
        Column {
            items.forEach { i ->
                val title = Format.bankText(i.title)
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("${shortDate(i.date)} · $title", Modifier.weight(1f), color = l.muted, style = MaterialTheme.typography.bodySmall)
                    androidx.compose.material3.TextButton(
                        onClick = {
                            if (!busy) {
                                busy = true
                                scope.launch {
                                    runCatching { launcher.undo("$IGNORED${i.key}") }
                                    busy = false
                                }
                            }
                        },
                        enabled = !busy,
                        modifier = Modifier.semantics { contentDescription = "Trazer de volta $title" },
                    ) { Text("Trazer de volta", color = l.accent, style = MaterialTheme.typography.labelLarge) }
                }
            }
        }
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
    // Longer when the system asks for it (TalkBack, a user's "time to take action" setting).
    val a11y = androidx.compose.ui.platform.LocalAccessibilityManager.current
    LaunchedEffect(entryId, text, busy) {
        if (text == null || busy) return@LaunchedEffect
        delay(a11y?.calculateRecommendedTimeoutMillis(UNDO_MS, containsIcons = false, containsText = true, containsControls = true) ?: UNDO_MS)
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
