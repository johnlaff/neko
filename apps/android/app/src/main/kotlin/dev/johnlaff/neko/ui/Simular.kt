package dev.johnlaff.neko.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.ScenarioBody
import dev.johnlaff.neko.data.ScenarioChange
import dev.johnlaff.neko.data.ScenarioDay
import dev.johnlaff.neko.data.ScenarioPoint
import dev.johnlaff.neko.data.ScenarioView
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.dayLabel
import dev.johnlaff.neko.ui.Format.monthName
import dev.johnlaff.neko.ui.Format.roundMoney
import dev.johnlaff.neko.ui.Format.toCents
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sign

/** Asks the Worker for a scenario; it throws when there is no connection. */
typealias AskScenario = suspend (ScenarioBody) -> ScenarioView

/** How Brazilian stores usually split a card purchase. */
private val PARCELS = listOf(1, 2, 3, 6, 10, 12)
/** Money in or out once, or on the same day for months (a freela, a loan's parcels). */
private val REPEATS = listOf(1, 3, 12, 24)
/** The engine's MAX_CHANGES. */
private const val MAX_CHANGES = 8
/** Past this a typo, not a plan: R$ 10 milhões. */
private const val MAX_AMOUNT = 1_000_000_000L
/** Waits for typing to pause before asking the Worker. */
private const val TYPING_PAUSE = 300L
/**
 * An amount as the owner writes it, also half typed: `250`, `1.500,50`, `1.500,`. A dot after the
 * comma, a sign or a letter is a typo, and it says so at once, as on the site.
 */
private val PT_MONEY = Regex("""^\d[\d.]*(,\d{0,2})?$""")

private val PACE_LABEL = mapOf("planilha" to "Só a planilha", "teto" to "Teto", "media" to "Média")
/** How each answer starts, so the premise is never in another panel than the number. */
private val PACE_LEAD = mapOf("planilha" to "Só com a planilha", "teto" to "Gastando o teto", "media" to "Gastando a média")
private val KIND_LABEL = mapOf("compra" to "Compra", "entrada" to "Entrada", "saida" to "Saída")

/** One "E se…" line as typed; kept across a rotation, forgotten when the screen closes. */
@Serializable
data class SimRow(val key: Int, val kind: String, val typed: String = "", val count: Int = 1, val date: String = "")

private val RowsSaver = Saver<List<SimRow>, String>(
    save = { json.encodeToString(ListSerializer(SimRow.serializer()), it) },
    restore = { json.decodeFromString(ListSerializer(SimRow.serializer()), it) },
)

private fun monthLabel(year: Int, month: Int, today: String) =
    monthName(month).take(3) + if (year.toString() == today.take(4)) "" else " $year"

/** The typed amount in cents, or null while it is empty, malformed or past any plan. */
private fun amountOf(typed: String): Long? {
    val t = typed.trim()
    if (!PT_MONEY.matches(t)) return null
    return toCents(t)?.takeIf { it in 1..MAX_AMOUNT }
}

/** The lines that say enough to simulate: an amount, and for money in or out a day from today on. */
private fun changesOf(rows: List<SimRow>, today: String?, card: Boolean): List<ScenarioChange> =
    rows.mapNotNull { r ->
        val amount = amountOf(r.typed) ?: return@mapNotNull null
        if (r.kind == "compra") {
            if (card) ScenarioChange("compra", amount, count = r.count) else null
        } else {
            val iso = isoDate(r.date, today?.take(4) ?: "") ?: return@mapNotNull null
            if (today == null || iso < today) null else ScenarioChange(r.kind, amount, date = iso, months = r.count)
        }
    }

/** "As mudanças tiram R$ 300 do menor saldo e R$ 1.800 do fim de dez 2027." */
internal fun deltaSentence(lowest: Long, end: Long, endLabel: String): String {
    fun part(d: Long, what: String, verb: Boolean) = when {
        d == 0L -> "não mexem no $what"
        d < 0 -> "${if (verb) "tiram " else ""}${roundMoney(-d)} do $what"
        else -> "${if (verb) "somam " else ""}${roundMoney(d)} ao $what"
    }
    val sameWay = lowest.sign == end.sign && lowest != 0L
    return "As mudanças ${part(lowest, "menor saldo", true)} e ${part(end, "fim de $endLabel", !sameWay)}."
}

/** The answer's sentence: the premise first, then the first red day or the lowest balance. */
internal fun verdictOf(v: ScenarioView): String {
    val lead = PACE_LEAD[v.pace] ?: ""
    v.firstNegative?.let { return "$lead, fica negativo em ${dayLabel(it.date, v.today)}." }
    val lo = v.lowest ?: return ""
    return "$lead, o menor saldo é ${roundMoney(lo.balance)}, em ${dayLabel(lo.date, v.today)}."
}

private fun deltaOf(v: ScenarioView): Pair<Long, Long>? {
    val base = v.base ?: return null
    val lo = v.lowest ?: return null
    val end = v.months.lastOrNull() ?: return null
    return (lo.balance - base.lowest) to (end.endSim - base.end)
}

/**
 * Simular, the site's /simular: how the months ahead would look from today, on demand. The sheet
 * keeps only what is certain; here the day-to-day spending and a few what-ifs shift copies of its
 * balances, as the method's own Ctrl+Z. The Worker answers; nothing is saved, and closing the
 * screen forgets it all.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SimularScreen(
    ask: AskScenario,
    onBack: () -> Unit,
    onAjustes: () -> Unit = {},
    /** For the prints: an answer drawn at once, and the lines it answers. */
    start: ScenarioView? = null,
    startRows: List<SimRow> = emptyList(),
) {
    val l = LocalLedger.current
    var rows by rememberSaveable(stateSaver = RowsSaver) { mutableStateOf(startRows) }
    var pace by rememberSaveable { mutableStateOf<String?>(start?.pace) }
    var next by rememberSaveable { mutableStateOf((startRows.maxOfOrNull { it.key } ?: -1) + 1) }
    var focusKey by remember { mutableStateOf<Int?>(null) }
    var view by remember { mutableStateOf(start) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableStateOf(0) }
    // Only typing waits for a pause; a tapped chip asks at once.
    var typing by remember { mutableStateOf(false) }
    // A first answer handed in (the prints) is drawn as it is; the next change asks.
    var first by remember { mutableStateOf(start != null) }
    val v = view
    val changes = changesOf(rows, v?.today, v?.card != null)
    LaunchedEffect(pace, changes, attempt) {
        if (first) {
            first = false
            return@LaunchedEffect
        }
        if (typing) delay(TYPING_PAUSE)
        try {
            view = ask(ScenarioBody(pace, changes))
            failed = false
        } catch (c: CancellationException) {
            throw c
        } catch (_: Throwable) {
            // Offline keeps the last answer on screen rather than flashing it away.
            failed = true
        }
    }
    val add = { kind: String ->
        val key = next++
        focusKey = key
        typing = false
        rows = rows + SimRow(key, kind, date = v?.today?.let(::typedDate) ?: "")
    }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    // The bar holds a one-line answer once the answer's sentence has scrolled away under it.
    val headPx = with(LocalDensity.current) { 110.dp.toPx() }
    val headSeen by remember {
        derivedStateOf {
            list.layoutInfo.visibleItemsInfo.firstOrNull { it.key == "answer" }?.let { it.offset > -headPx } ?: false
        }
    }

    Column(
        Modifier.fillMaxSize().background(l.bg).safeDrawingPadding().semantics { paneTitle = "Simular" },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 640.dp).fillMaxWidth().weight(1f)) {
            Row(
                Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                IconButton(onClick = onBack) {
                    Icon(painterResource(R.drawable.ic_chevron_left), "Voltar", tint = l.text)
                }
                Text("Simular", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f).semantics { heading() })
            }
            AnimatedVisibility(
                visible = v != null && rows.isNotEmpty() && !headSeen,
                enter = fadeIn(tween(180)) + expandVertically(tween(180, easing = Motion.Settle)),
                exit = fadeOut(tween(120)) + shrinkVertically(tween(160, easing = Motion.Settle)),
            ) {
                if (v != null) Peek(v) { scope.launch { list.animateScrollToItem(1) } }
            }
            HorizontalDivider(color = l.border)
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                state = list,
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                item(key = "lead") {
                    Text(
                        (v?.readAt?.let(::readAtText)?.takeIf { it.isNotEmpty() }?.let { "Planilha lida $it. " } ?: "") +
                            "Nada aqui muda a planilha; quando você sai, tudo some.",
                        color = l.faint,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                if (v == null) {
                    item(key = "wait") {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                if (failed) "Não consegui simular agora. A planilha não foi alterada." else "Simulando…",
                                color = l.muted,
                                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                            )
                            if (failed) TextAction("Tentar de novo", { attempt++ }, color = l.accent)
                        }
                    }
                    return@LazyColumn
                }
                if (v.days.size < 2) {
                    item(key = "short") {
                        Text(
                            "A planilha termina hoje: não há meses à frente para simular. Abra a aba do próximo ano na planilha e volte aqui.",
                            color = l.muted,
                        )
                    }
                    return@LazyColumn
                }
                item(key = "answer") { Answer(v, failed) }
                item(key = "changes") {
                    Panel(Modifier.animateContentSize(tween(220, easing = Motion.Settle))) {
                        PanelHead("E se…")
                        if (rows.isEmpty()) {
                            Text(
                                "Uma compra parcelada, um freela, um empréstimo: veja como fica antes de decidir. Um empréstimo é uma Entrada e uma Saída por vários meses.",
                                color = l.muted,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                        rows.forEachIndexed { i, row ->
                            if (i > 0) HorizontalDivider(color = l.border)
                            ChangeRow(
                                row, v,
                                focus = focusKey == row.key,
                                onFocused = { focusKey = null },
                                onChange = { patch, typed ->
                                    typing = typed
                                    rows = rows.map { if (it.key == row.key) patch else it }
                                },
                                onRemove = {
                                    typing = false
                                    // The focus goes to the line next to it.
                                    focusKey = (rows.getOrNull(i - 1) ?: rows.getOrNull(i + 1))?.key
                                    rows = rows.filterNot { it.key == row.key }
                                },
                            )
                        }
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            maxItemsInEachRow = 3,
                        ) {
                            listOf("compra", "entrada", "saida").filter { it != "compra" || v.card != null }.forEach { k ->
                                AddButton(KIND_LABEL.getValue(k), rows.size < MAX_CHANGES, Modifier.weight(1f)) { add(k) }
                            }
                        }
                        when {
                            rows.size >= MAX_CHANGES ->
                                Text("Até $MAX_CHANGES mudanças de cada vez.", color = l.faint, style = MaterialTheme.typography.bodyMedium)
                            v.card == null ->
                                TextAction("Para simular uma compra, escolha o cartão principal em Ajustes ›", onAjustes, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                item(key = "pace") { PacePicker(v, pace ?: v.pace, onAjustes) { typing = false; pace = it } }
            }
        }
    }
}

/** The answer in one line, under the bar, while the real one is scrolled away; a tap goes back to it. */
@Composable
private fun Peek(v: ScenarioView, onClick: () -> Unit) {
    val l = LocalLedger.current
    val red = v.firstNegative
    val lowest = deltaOf(v)?.first
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClickLabel = "ver a resposta", onClick = onClick)
            .heightIn(min = 40.dp)
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            red?.let { "Negativo em ${dayLabel(it.date, v.today)}" } ?: v.lowest?.let { "Menor saldo ${roundMoney(it.balance)}" } ?: "",
            color = if (red != null) l.neg else l.text,
            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
        )
        if (lowest != null && lowest != 0L) {
            Text("${roundMoney(abs(lowest))} ${if (lowest < 0) "a menos" else "a mais"}", color = l.faint, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** The answer: the sentence with its premise, what the changes did, two figures, the chart and its table. */
@Composable
private fun Answer(v: ScenarioView, failed: Boolean) {
    val l = LocalLedger.current
    val same = v.days.all { it.sim == it.sheet }
    val end = v.months.lastOrNull()
    val endLabel = end?.let { monthLabel(it.year, it.month, v.today) } ?: ""
    val delta = deltaOf(v)
    var table by rememberSaveable { mutableStateOf(false) }
    val verdict = verdictOf(v)
    Panel {
        // One heading TalkBack reads again when the answer changes: the sentence and what changed it.
        Column(
            Modifier.semantics(mergeDescendants = true) { heading(); liveRegion = LiveRegionMode.Polite },
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(verdict, style = MaterialTheme.typography.headlineSmall)
            if (delta != null) {
                Text(deltaSentence(delta.first, delta.second, endLabel), color = l.muted, style = MaterialTheme.typography.bodyMedium)
            }
        }
        Row(Modifier.fillMaxWidth()) {
            if (end != null) {
                Figure(
                    "Fim de $endLabel",
                    roundMoney(end.endSim),
                    if (end.endSim < 0) l.neg else l.text,
                    if (v.pace != "planilha" && end.endSim != end.endSheet) "Planilha: ${roundMoney(end.endSheet)}" else null,
                    Modifier.weight(1f),
                )
            }
            val s = v.saving
            Figure(
                "Dá para guardar",
                s?.let { roundMoney(it.amount) } ?: "Nada",
                l.text,
                when {
                    s != null -> if (s.date == v.today) "hoje" else "em ${dayLabel(s.date, v.today)}"
                    v.firstNegative != null -> "o saldo fica negativo"
                    else -> "sobra pouco no menor saldo"
                },
                Modifier.weight(1f),
                end = true,
            )
        }
        if (failed) Text("Sem conexão: este é o último resultado.", color = l.warn, style = MaterialTheme.typography.bodyMedium)
        if (!same) Legend()
        SimChart(v.days, same, v.today, v.firstNegative ?: v.lowest, "Saldo de hoje até ${dayLabel(v.end, v.today)}. $verdict")
        TextAction("Mês a mês", { table = !table }, open = table)
        if (table) MonthTable(v, same)
    }
}

@Composable
private fun Figure(label: String, value: String, color: Color, note: String?, modifier: Modifier, end: Boolean = false) {
    val l = LocalLedger.current
    val align = if (end) TextAlign.End else TextAlign.Start
    Column(modifier.semantics(mergeDescendants = true) {}, horizontalAlignment = if (end) Alignment.End else Alignment.Start) {
        Text(label, color = l.faint, style = MaterialTheme.typography.labelMedium, textAlign = align)
        Text(value, color = color, style = MaterialTheme.typography.titleLarge, textAlign = align)
        if (note != null) Text(note, color = l.faint, style = MaterialTheme.typography.labelMedium, textAlign = align)
    }
}

@Composable
private fun Legend() {
    val l = LocalLedger.current
    Row(Modifier.clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        listOf("Planilha" to l.borderInput, "Simulação" to l.accent).forEach { (name, color) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.size(width = 14.dp, height = 2.dp).background(color))
                Text(name, color = l.muted, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

@Composable
private fun MonthTable(v: ScenarioView, same: Boolean) {
    val l = LocalLedger.current
    val style = MaterialTheme.typography.bodyMedium
    Column {
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
            Text("Fim de", Modifier.weight(1f), color = l.faint, style = MaterialTheme.typography.labelMedium)
            if (!same) Text("Planilha", Modifier.weight(1f), color = l.faint, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.End)
            Text(if (same) "Saldo" else "Simulação", Modifier.weight(1f), color = l.faint, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.End)
        }
        v.months.forEach { m ->
            HorizontalDivider(color = l.border)
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp).semantics(mergeDescendants = true) {}) {
                Text(capitalize(monthLabel(m.year, m.month, v.today)), Modifier.weight(1f), color = l.muted, style = style)
                if (!same) Text(roundMoney(m.endSheet), Modifier.weight(1f), color = if (m.endSheet < 0) l.neg else l.text, style = style, textAlign = TextAlign.End)
                Text(roundMoney(m.endSim), Modifier.weight(1f), color = if (m.endSim < 0) l.neg else l.text, style = style, textAlign = TextAlign.End)
            }
        }
    }
}

/** What the premise means, and which of the ceiling and the average is the cautious one. */
internal fun premiseOf(v: ScenarioView, pace: String): String {
    val now = v.today.substring(5, 7).toInt()
    val rest = "${capitalize(monthName(now))} segue a planilha. De ${monthName((now % 12) + 1)} em diante"
    val monthly = v.monthly
    val teto = v.spends.teto
    val media = v.spends.media
    return when {
        pace == "planilha" || monthly == null ->
            "Só o que já está na planilha. Os meses à frente ainda não têm o gasto do dia a dia, então parecem melhores do que vão ser."
        pace == "teto" ->
            "$rest, cada mês gasta o teto de ${roundMoney(monthly)} em cartões e Pix, com as faturas que já estão na planilha dentro dele." +
                when {
                    media == null || media == monthly -> ""
                    media > monthly -> " Nos últimos 3 meses a média foi ${roundMoney(media)}, acima dele: a Média é a conta mais cautelosa."
                    else -> " Nos últimos 3 meses a média foi ${roundMoney(media)}, abaixo dele: esta é a conta mais cautelosa."
                }
        else ->
            "$rest, cada mês gasta ${roundMoney(monthly)}, a média dos últimos 3 meses, com as faturas que já estão na planilha dentro dela." +
                when {
                    teto == null || teto == monthly -> ""
                    monthly > teto -> " Passa do teto de ${roundMoney(teto)}: esta é a conta mais cautelosa."
                    else -> " Fica abaixo do teto de ${roundMoney(teto)}: o Teto é a conta mais cautelosa."
                }
    }
}

/** The spending of the day to day the months ahead take, what that premise means, and when. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PacePicker(v: ScenarioView, pace: String, onAjustes: () -> Unit, onPick: (String) -> Unit) {
    val l = LocalLedger.current
    Panel {
        PanelHead("Gasto do dia a dia")
        if (v.paces.size > 1) {
            ChipGrid(v.paces.map { PACE_LABEL[it] ?: it }, v.paces.indexOf(pace)) { onPick(v.paces[it]) }
        }
        Text(premiseOf(v, pace), color = l.muted, style = MaterialTheme.typography.bodyMedium)
        if (v.spends.teto == null) {
            TextAction("Para ver gastando o teto, defina o teto do mês em Ajustes ›", onAjustes, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChangeRow(
    row: SimRow,
    v: ScenarioView,
    focus: Boolean,
    onFocused: () -> Unit,
    onChange: (SimRow, Boolean) -> Unit,
    onRemove: () -> Unit,
) {
    val l = LocalLedger.current
    val compra = row.kind == "compra"
    val title = if (compra) "Compra${v.card?.let { " no $it" } ?: ""}" else KIND_LABEL.getValue(row.kind)
    val field = remember { FocusRequester() }
    LaunchedEffect(focus) {
        if (focus) {
            runCatching { field.requestFocus() }
            onFocused()
        }
    }
    val colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = l.accent, unfocusedBorderColor = l.borderInput)
    val iso = if (compra) null else isoDate(row.date, v.today.take(4))
    val outOfRange = !compra && (iso == null || iso < v.today || iso > v.end)
    val typed = row.typed.trim()
    val tooBig = PT_MONEY.matches(typed) && (toCents(typed) ?: 0L) > MAX_AMOUNT
    // A zero on its way to "0,50" is not wrong yet: it only does not count.
    val bad = typed.isNotEmpty() && (!PT_MONEY.matches(typed) || tooBig)
    val amount = amountOf(row.typed)
    Column(Modifier.appear(220), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // A line's name sits under the panel's "E se…", one step quieter.
            Text(title, color = l.muted, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            IconButton(onClick = onRemove) {
                Icon(painterResource(R.drawable.ic_close), "Tirar ${title.replaceFirstChar { it.lowercase() }}", tint = l.muted, modifier = Modifier.size(20.dp))
            }
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            maxItemsInEachRow = 2,
        ) {
            OutlinedTextField(
                value = row.typed,
                onValueChange = { if (it.length <= 16) onChange(row.copy(typed = it), true) },
                label = { Text("Valor") },
                singleLine = true,
                isError = bad,
                supportingText = if (bad) {
                    { Text(if (tooBig) "Valor alto demais para simular." else "Use um valor como 1.500,00.") }
                } else null,
                prefix = { Text("R$ ", color = l.faint) },
                placeholder = { Text("0,00", color = l.faint) },
                textStyle = MaterialTheme.typography.titleLarge,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                colors = colors,
                modifier = Modifier.weight(1.2f).widthIn(min = 140.dp).focusRequester(field).semantics { contentDescription = "$title: valor" },
            )
            if (!compra) {
                OutlinedTextField(
                    value = row.date,
                    onValueChange = { onChange(row.copy(date = it), true) },
                    label = { Text("Dia") },
                    singleLine = true,
                    isError = outOfRange,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                    colors = colors,
                    modifier = Modifier.weight(1f).widthIn(min = 130.dp),
                )
            }
        }
        val counts = if (compra) PARCELS else REPEATS
        ChipGrid(
            counts.map { n -> if (compra) (if (n == 1) "À vista" else "$n×") else if (n == 1) "Uma vez" else "$n meses" },
            counts.indexOf(row.count),
        ) { onChange(row.copy(count = counts[it]), false) }
        // What the line does, one fact a line: no separator left dangling where a line wraps.
        val note = if (compra) {
            listOfNotNull(
                v.canSpend?.let { cs ->
                    val fig = simFigure(cs.mode, cs.left, cs.overBy, if (amount != null) v.cycle else null)
                    "${fig.label} ${roundMoney(fig.amount)}" to (if (fig.over) l.neg else l.faint)
                },
                v.due?.let { "${if (row.count > 1) "1ª parcela" else "Sai da conta"} em ${dayLabel(it, v.today)}" to l.faint },
            )
        } else {
            listOf(
                when {
                    outOfRange -> "Escolha um dia de hoje até ${dayLabel(v.end, v.today)}."
                    row.count > 1 -> "Todo dia ${iso!!.takeLast(2).toInt()}, ${row.count} meses seguidos."
                    iso == v.today -> "Hoje."
                    else -> "Em ${dayLabel(iso!!, v.today)}."
                } to (if (outOfRange) l.neg else l.faint),
            )
        }
        Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            note.forEach { (text, color) -> Text(text, color = color, style = MaterialTheme.typography.bodyMedium) }
        }
    }
}

@Composable
private fun AddButton(text: String, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val l = LocalLedger.current
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 44.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = l.text),
        border = androidx.compose.foundation.BorderStroke(1.dp, l.borderInput),
        shape = RoundedCornerShape(10.dp),
        contentPadding = PaddingValues(horizontal = 8.dp),
    ) {
        Icon(painterResource(R.drawable.ic_add), null, Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1, softWrap = false)
    }
}

/** "20 mil", "−5 mil", "0": an axis reads in thousands of reais, never in cents. */
private fun axisMoney(cents: Long): String {
    if (cents == 0L) return "0"
    val k = (abs(cents) / 100_000.0).roundToInt()
    val thousands = k.toString().reversed().chunked(3).joinToString(".").reversed()
    return "${if (cents < 0) "−" else ""}$thousands mil"
}

/** About four round steps that cover the whole range, so no line runs off the top (the site's ticksFor). */
internal fun ticksFor(lo: Long, hi: Long): List<Long> {
    val span = max(hi - lo, 100_000L).toDouble()
    val raw = span / 4
    val mag = 10.0.pow(floor(log10(raw)))
    val step = listOf(1.0, 2.0, 2.5, 5.0, 10.0).map { it * mag }.firstOrNull { it >= raw } ?: raw
    val out = mutableListOf<Long>()
    var v = floor(lo / step) * step
    while (true) {
        out += Math.round(v)
        if (v >= hi) break
        v += step
    }
    return out
}

/**
 * Pills sharing a row as the site's flex chips do: equal widths when they fit, a long label taking
 * what it needs and the rest sharing what is left; as many to a row as fit, the rows balanced (six
 * parcels as 3 and 3, never 5 and 1). With big text they fall to fewer per row, never squeezed.
 */
@Composable
private fun ChipGrid(labels: List<String>, selected: Int, onPick: (Int) -> Unit) {
    val measurer = rememberTextMeasurer()
    val style = MaterialTheme.typography.labelLarge
    val density = LocalDensity.current
    // A pill's own width: its label, the padding and border around it, never under a finger's.
    val own = labels.map { with(density) { measurer.measure(it, style).size.width.toDp() }.value + 30f }.map { max(it, 48f) }
    BoxWithConstraints(Modifier.fillMaxWidth().selectableGroup()) {
        val gap = 8f
        val room = maxWidth.value
        val fits = { row: List<Int> -> row.sumOf { own[it].toDouble() } + gap * (row.size - 1) <= room }
        val perRow = (1..labels.size)
            .map { r -> ceil(labels.size / r.toFloat()).toInt() }
            .firstOrNull { k -> labels.indices.chunked(k).all(fits) } ?: 1
        Column(verticalArrangement = Arrangement.spacedBy(gap.dp)) {
            labels.indices.chunked(perRow).forEach { row ->
                // Equal shares of the row (the last row keeps the others' share), a wider label first.
                var free = room - gap * (perRow - 1)
                var slots = perRow
                val wide = mutableMapOf<Int, Float>()
                while (true) {
                    val share = free / slots
                    val more = row.filter { it !in wide && own[it] > share }
                    if (more.isEmpty()) break
                    more.forEach { wide[it] = own[it]; free -= own[it]; slots-- }
                }
                val share = free / slots
                Row(horizontalArrangement = Arrangement.spacedBy(gap.dp)) {
                    row.forEach { i ->
                        Box(Modifier.width((wide[i] ?: share).dp), contentAlignment = Alignment.Center) {
                            Choice(labels[i], i == selected, fill = true) { onPick(i) }
                        }
                    }
                }
            }
        }
    }
}

/**
 * The site's SimChart: the sheet as it is (quiet) and the simulation (accent, red where it goes
 * below zero, on a red wash) from today to the sheet's last day, the amounts in a gutter of their
 * own and a dot on the day the answer names. A finger reads any day; the table carries every
 * month's value for TalkBack.
 */
@Composable
private fun SimChart(days: List<ScenarioDay>, same: Boolean, today: String, mark: ScenarioPoint?, label: String) {
    val l = LocalLedger.current
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val target = remember(days) { days.map { it.sim.toFloat() } }
    var shown by remember { mutableStateOf(target) }
    // The simulation's line moves to a new answer instead of jumping; Android's "Remove
    // animations" makes it jump, as the site's reduced motion does.
    LaunchedEffect(target) {
        val from = shown
        if (from.size != target.size) {
            shown = target
            return@LaunchedEffect
        }
        val t = Animatable(0f)
        t.animateTo(1f, tween(260, easing = Motion.Settle)) {
            shown = List(target.size) { i -> from[i] + (target[i] - from[i]) * value }
        }
        shown = target
    }
    var at by remember(days.size) { mutableStateOf<Int?>(null) }
    val small = TextStyle(fontFamily = Geist, fontSize = 11.sp, color = l.faint)
    val tip = MaterialTheme.typography.labelMedium
    if (days.size < 2) return
    val values = days.map { it.sheet } + days.map { it.sim } + 0L
    val ticks = remember(days) { ticksFor(values.min(), values.max()) }
    // The left side is a gutter for the amounts, so no line ever runs through a label.
    val gutter = ticks.maxOf { measurer.measure(axisMoney(it), small).size.width } + with(density) { 10.dp.toPx() }
    val markAt = mark?.let { m -> days.indexOfFirst { it.date == m.date } } ?: -1
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(200.dp)
            .semantics { contentDescription = label }
            .pointerInput(days.size, gutter) {
                val right = 8.dp.toPx()
                val pick = { x: Float -> ((x - gutter) / (size.width - gutter - right) * (days.size - 1)).roundToInt().coerceIn(0, days.size - 1) }
                detectTapGestures { at = pick(it.x) }
            }
            .pointerInput(days.size, gutter) {
                val right = 8.dp.toPx()
                val pick = { x: Float -> ((x - gutter) / (size.width - gutter - right) * (days.size - 1)).roundToInt().coerceIn(0, days.size - 1) }
                detectHorizontalDragGestures(onDragStart = { at = pick(it.x) }) { change, _ -> at = pick(change.position.x) }
            },
    ) {
        val padTop = 12.dp.toPx()
        val padRight = 8.dp.toPx()
        val padBottom = 26.dp.toPx()
        val lo = ticks.first().toFloat()
        val hi = ticks.last().toFloat()
        val plotW = size.width - gutter - padRight
        val plotH = size.height - padTop - padBottom
        val bottom = size.height - padBottom
        val x = { i: Int -> gutter + i.toFloat() / (days.size - 1) * plotW }
        val y = { v: Float -> padTop + (hi - v) / (if (hi - lo == 0f) 1f else hi - lo) * plotH }
        val zero = y(0f)
        if (zero > padTop && zero < bottom) {
            drawRect(l.neg.copy(alpha = 0.09f), Offset(gutter, zero), Size(plotW, bottom - zero))
        }
        ticks.forEach { t ->
            val ty = y(t.toFloat())
            drawLine(if (t == 0L) l.borderInput else l.border, Offset(gutter, ty), Offset(size.width - padRight, ty), 1.dp.toPx())
            val text = measurer.measure(axisMoney(t), small)
            drawText(text, topLeft = Offset(gutter - 8.dp.toPx() - text.size.width, ty - text.size.height / 2f))
        }
        val line = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
        if (!same) drawPath(path(days.map { it.sheet.toFloat() }, x, y), l.borderInput, style = line)
        // Below zero the line itself turns red, not only the wash behind it.
        val sim = path(shown, x, y)
        clipRect(top = 0f, bottom = zero) { drawPath(sim, if (same) l.muted else l.accent, style = line) }
        clipRect(top = zero, bottom = size.height) { drawPath(sim, l.neg, style = line) }
        val ring = 2.dp.toPx()
        // The day the answer names, ringed in the panel's color so it reads over the line.
        if (markAt >= 0) {
            val v = shown.getOrElse(markAt) { 0f }
            val c = Offset(x(markAt), y(v))
            drawCircle(l.surface, 4.5.dp.toPx() + ring, c)
            drawCircle(if (v < 0) l.neg else if (same) l.muted else l.accent, 4.5.dp.toPx(), c)
        }
        // A month's name at each first day, every second or third month on a narrow screen; the
        // year on the first one when the chart spans more than one, and where it turns.
        val firsts = days.indices.filter { days[it].date.endsWith("-01") }
        val every = ceil(firsts.size / max(2f, floor(plotW / 64.dp.toPx()))).toInt().coerceAtLeast(1)
        var was = if (today.take(4) != days.last().date.take(4)) "" else today.take(4)
        firsts.filterIndexed { k, _ -> k % every == 0 }.forEach { i ->
            val d = days[i].date
            val name = monthName(d.substring(5, 7).toInt()).take(3) + if (d.take(4) == was) "" else " ${d.substring(2, 4)}"
            was = d.take(4)
            val text = measurer.measure(name, small)
            drawText(text, topLeft = Offset(x(i) - text.size.width / 2f, size.height - 8.dp.toPx() - text.size.height * 0.8f))
        }
        val i = at ?: return@Canvas
        val d = days[i]
        val cx = x(i)
        drawLine(l.faint, Offset(cx, padTop), Offset(cx, bottom), 1.dp.toPx())
        if (!same) {
            drawCircle(l.surface, 4.dp.toPx() + ring, Offset(cx, y(d.sheet.toFloat())))
            drawCircle(l.borderInput, 4.dp.toPx(), Offset(cx, y(d.sheet.toFloat())))
        }
        drawCircle(l.surface, 4.dp.toPx() + ring, Offset(cx, y(d.sim.toFloat())))
        drawCircle(if (d.sim < 0) l.neg else if (same) l.muted else l.accent, 4.dp.toPx(), Offset(cx, y(d.sim.toFloat())))
        // The day read, beside the line on the side with more room, so it never covers the dots.
        val lines = buildList {
            add(measurer.measure(dayLabel(d.date, today), tip.copy(color = l.faint)))
            add(measurer.measure("${roundMoney(d.sim)}${if (same) "" else " simulação"}", tip.copy(color = l.text)))
            if (!same) add(measurer.measure("${roundMoney(d.sheet)} planilha", tip.copy(color = l.muted)))
        }
        val padIn = 10.dp.toPx()
        val w = lines.maxOf { it.size.width } + 2 * padIn
        val h = lines.sumOf { it.size.height } + 2 * 8.dp.toPx()
        val left = if (cx > size.width / 2) cx - 12.dp.toPx() - w else cx + 12.dp.toPx()
        val top = 4.dp.toPx()
        drawRoundRect(l.surface2, Offset(left, top), Size(w, h), CornerRadius(8.dp.toPx()))
        drawRoundRect(l.border, Offset(left, top), Size(w, h), CornerRadius(8.dp.toPx()), style = Stroke(1.dp.toPx()))
        var ly = top + 8.dp.toPx()
        lines.forEach {
            drawText(it, topLeft = Offset(left + padIn, ly))
            ly += it.size.height
        }
    }
}

private fun path(values: List<Float>, x: (Int) -> Float, y: (Float) -> Float) = Path().apply {
    values.forEachIndexed { i, v -> if (i == 0) moveTo(x(i), y(v)) else lineTo(x(i), y(v)) }
}
