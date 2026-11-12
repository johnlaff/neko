package dev.johnlaff.neko.ui

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.PathEffect
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
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.ScenarioBody
import dev.johnlaff.neko.data.ScenarioChange
import dev.johnlaff.neko.data.ScenarioChangeEffect
import dev.johnlaff.neko.data.ScenarioDay
import dev.johnlaff.neko.data.ScenarioEffect
import dev.johnlaff.neko.data.ScenarioPoint
import dev.johnlaff.neko.data.ScenarioView
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.dayLabel
import dev.johnlaff.neko.ui.Format.monthName
import dev.johnlaff.neko.ui.Format.roundMoney
import dev.johnlaff.neko.ui.Format.toCents
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.math.sign
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

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
/** One change on its own is the subject of the answer's sentence. */
private val KIND_NOUN = mapOf("compra" to "A compra", "entrada" to "A entrada", "saida" to "A saída")
/** Where a purchase's parcels go when the pace already fills the month. */
private val PACE_INSIDE = mapOf("teto" to "dentro do teto", "media" to "dentro da média")

/** One "E se…" line as typed; kept across a rotation, forgotten when the screen closes. */
@Serializable
data class SimRow(val key: Int, val kind: String, val typed: String = "", val count: Int = 1, val date: String = "")

private val RowsSaver = Saver<List<SimRow>, String>(
    save = { json.encodeToString(ListSerializer(SimRow.serializer()), it) },
    restore = { json.decodeFromString(ListSerializer(SimRow.serializer()), it) },
)

/**
 * "dez", or "dez 2027" when it is not this year: the same month in every place on the screen,
 * never broken across two lines.
 */
private fun monthLabel(year: Int, month: Int, today: String) =
    monthName(month).take(3) + if (year.toString() == today.take(4)) "" else "\u00a0$year"

/** "12 mai 2027" in one piece: a date never breaks across lines in a sentence. */
private fun dayOf(iso: String, today: String) = dayLabel(iso, today).replace(' ', '\u00a0')

private fun monthOf(yyyyMm: String, today: String) = monthLabel(yyyyMm.take(4).toInt(), yyyyMm.substring(5, 7).toInt(), today)

/** The typed amount in cents, or null while it is empty, malformed or past any plan. */
private fun amountOf(typed: String): Long? {
    val t = typed.trim()
    if (!PT_MONEY.matches(t)) return null
    return toCents(t)?.takeIf { it in 1..MAX_AMOUNT }
}

/** A line that says enough to simulate, with the line it came from. */
private data class Asked(val key: Int, val kind: String, val change: ScenarioChange)

/** The lines that say enough to simulate: an amount, and for money in or out a day from today on. */
private fun changesOf(rows: List<SimRow>, today: String?, card: Boolean): List<Asked> =
    rows.mapNotNull { r ->
        val amount = amountOf(r.typed) ?: return@mapNotNull null
        if (r.kind == "compra") {
            if (card) Asked(r.key, r.kind, ScenarioChange("compra", amount, count = r.count)) else null
        } else {
            val iso = isoDate(r.date, today?.take(4) ?: "") ?: return@mapNotNull null
            if (today == null || iso < today) null else Asked(r.key, r.kind, ScenarioChange(r.kind, amount, date = iso, months = r.count))
        }
    }

/** Under a real the amount reads R$ 0: say it does not move it, never "tira R$ 0". */
private fun none(d: Long) = (d / 100.0).roundToLong() == 0L

/**
 * "As mudanças tiram R$ 300 do menor saldo e R$ 1.800 do fim de dez 2027", with no period, so the
 * caller goes on. With one change it is that change, in the singular ("A compra tira…"), and
 * "Sozinha, tira…" in its own line. The same amount on both reads once: "…do menor saldo e do fim".
 */
internal fun deltaSentence(lowest: Long, end: Long, endWhat: String, who: String = "As mudanças", plural: Boolean = true): String {
    fun verb(pl: String, sg: String) = if (plural) pl else sg
    if (none(lowest) && none(end)) return "$who ${verb("não mexem", "não mexe")} no menor saldo nem no $endWhat"
    val low = (lowest / 100.0).roundToLong()
    if (low == (end / 100.0).roundToLong()) {
        return if (low < 0) "$who ${verb("tiram", "tira")} ${roundMoney(-lowest)} do menor saldo e do $endWhat"
        else "$who ${verb("somam", "soma")} ${roundMoney(lowest)} ao menor saldo e ao $endWhat"
    }
    fun part(d: Long, what: String, withVerb: Boolean) = when {
        none(d) -> "${verb("não mexem", "não mexe")} no $what"
        d < 0 -> "${if (withVerb) "${verb("tiram", "tira")} " else ""}${roundMoney(-d)} do $what"
        else -> "${if (withVerb) "${verb("somam", "soma")} " else ""}${roundMoney(d)} ao $what"
    }
    val sameWay = lowest.sign == end.sign && !none(lowest) && !none(end)
    return "$who ${part(lowest, "menor saldo", true)} e ${part(end, endWhat, !sameWay)}"
}

/** What the pace holds of the purchases, as a clause: "R$ 2.700 das parcelas ficam dentro do teto". */
internal fun inPaceClause(effects: List<ScenarioChangeEffect>, pace: String): String {
    val total = effects.sumOf { it.inPace?.amount ?: 0L }
    return if (total > 0) "${roundMoney(total)} das parcelas ficam ${PACE_INSIDE[pace] ?: ""}" else ""
}

/** One quiet line under the answer: what the changes did to it, and what the pace kept of them. */
internal fun headOf(v: ScenarioView, single: String?): String {
    val e = v.effect ?: return ""
    val last = v.months.lastOrNull() ?: return ""
    val delta = deltaSentence(
        e.lowest, e.end, "fim de ${monthLabel(last.year, last.month, v.today)}",
        single?.let { KIND_NOUN.getValue(it) } ?: "As mudanças", single == null,
    )
    val held = if (v.firstNegative != null) "" else inPaceClause(v.effects, v.pace)
    if (held.isEmpty()) return "$delta."
    return "$delta${if (none(e.lowest) && none(e.end)) ":" else ";"} $held."
}

/**
 * The answer's sentence: the premise first, then the lowest balance and its day, or in the red
 * when it goes negative and how deep. A lowest day in the sheet's last month may not be the
 * bottom, and it says so.
 */
internal fun verdictOf(v: ScenarioView): String {
    val lead = PACE_LEAD[v.pace] ?: ""
    // Months whose bills take the whole pace leave the day to day out: the answer is the best case.
    val best = v.full.isNotEmpty()
    val lo = v.lowest ?: return v.firstNegative?.let { "$lead, fica negativo em ${dayOf(it.date, v.today)}." } ?: ""
    val edge = if (lo.date.take(7) == v.end.take(7)) ", no último mês da planilha" else ""
    v.firstNegative?.let {
        return "$lead, ${if (best) "mesmo no melhor caso " else ""}fica negativo em ${dayOf(it.date, v.today)} " +
            "e chega a ${roundMoney(lo.balance)}${if (best) "" else edge}."
    }
    return "$lead, ${if (best) "no melhor caso " else ""}o menor saldo é ${roundMoney(lo.balance)}, em ${dayOf(lo.date, v.today)}$edge."
}

/**
 * "Em nov", "Em nov e jan 2027", "De nov a set 2027, em 11 meses," or "Em 7 dos 9 meses de nov a
 * jul 2027,": the months a premise leaves bare, never a count that reads as wrong arithmetic.
 */
private fun monthsSpan(months: List<String>, today: String): String {
    val first = months.firstOrNull() ?: return ""
    val last = months.last()
    fun index(m: String) = m.take(4).toInt() * 12 + m.substring(5, 7).toInt()
    val span = index(last) - index(first) + 1
    return when {
        months.size == 1 -> "Em ${monthOf(first, today)}"
        months.size == 2 -> "Em ${monthOf(first, today)} e ${monthOf(last, today)}"
        span == months.size -> "De ${monthOf(first, today)} a ${monthOf(last, today)}, em $span meses,"
        else -> "Em ${months.size} dos $span meses de ${monthOf(first, today)} a ${monthOf(last, today)},"
    }
}

/** Where the bills alone already take the pace, the answer counts nothing else that month. */
internal fun bareOf(v: ScenarioView): String =
    if (v.monthly == null || v.full.isEmpty()) ""
    else "${monthsSpan(v.full, v.today)} as faturas já tomam ${if (v.pace == "teto") "o teto todo" else "a média toda"}. " +
        "Nesses meses a conta não deixa nada para o dia a dia: é o melhor caso."

/**
 * What a purchase leaves of the plan it lands on, said as Simular says it: "Ainda cabem R$ 900 no
 * diário de novembro", "Passa R$ 300 do teto das faturas de dezembro".
 */
private fun fitText(mode: String, due: String, today: String, amount: Long, over: Boolean): String {
    val plan = when {
        mode == "month" || due.length < 7 -> "diário de ${monthName(today.substring(5, 7).toInt())}"
        mode == "cards" -> "teto das faturas de ${monthName(due.substring(5, 7).toInt())}"
        else -> "plano da fatura de ${monthName(due.substring(5, 7).toInt())}"
    }
    return if (over) "Passa ${roundMoney(amount)} do $plan." else "Ainda cabem ${roundMoney(amount)} no $plan."
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
    // The line just taken out, and where it was, until the next change: one tap puts it back.
    var removed by remember { mutableStateOf<Pair<SimRow, Int>?>(null) }
    var view by remember { mutableStateOf(start) }
    // The lines the answer on screen was asked for: its effects follow them, in order.
    var answered by remember { mutableStateOf<List<Asked>?>(null) }
    var leaving by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableStateOf(0) }
    // Only typing waits for a pause; a tapped chip asks at once.
    var typing by remember { mutableStateOf(false) }
    // A first answer handed in (the prints) is drawn as it is; the next change asks.
    var first by remember { mutableStateOf(start != null) }
    val v = view
    val asked = changesOf(rows, v?.today, v?.card != null)
    val changes = asked.map { it.change }
    LaunchedEffect(pace, changes, attempt) {
        if (first) {
            first = false
            answered = asked
            return@LaunchedEffect
        }
        if (typing) delay(TYPING_PAUSE)
        try {
            view = ask(ScenarioBody(pace, changes))
            answered = asked
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
        removed = null
        rows = rows + SimRow(key, kind, date = v?.today?.let(::typedDate) ?: "")
    }
    // What the answer on screen used, line by line; the engine's refusals are left out of it.
    val used = (answered ?: emptyList()).filterIndexed { i, _ -> v == null || i !in v.refused }
    val refused = (answered ?: emptyList()).filterIndexed { i, _ -> v != null && i in v.refused }
    val effectOf = { key: Int -> used.indexOfFirst { it.key == key }.takeIf { it >= 0 }?.let { v?.effects?.getOrNull(it) } }
    // Leaving with lines typed asks first: a stray back gesture never wipes them.
    val back = { if (rows.isEmpty()) onBack() else leaving = true }
    BackHandler(enabled = rows.isNotEmpty()) { leaving = true }
    if (leaving) {
        AlertDialog(
            onDismissRequest = { leaving = false },
            title = { Text("Sair e apagar as mudanças?", style = MaterialTheme.typography.headlineSmall) },
            text = {
                Text(
                    "Nada daqui foi salvo, e a planilha não mudou. Ao sair, ${if (rows.size == 1) "a mudança some" else "as ${rows.size} mudanças somem"}.",
                    color = l.muted,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    leaving = false
                    onBack()
                }) { Text("Sair", color = l.accent) }
            },
            dismissButton = { TextButton(onClick = { leaving = false }) { Text("Continuar aqui", color = l.text) } },
            containerColor = l.surface,
        )
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
                IconButton(onClick = back) {
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
                item(key = "answer") {
                    Answer(v, failed, single = used.singleOrNull()?.kind, onAjustes = onAjustes) { typing = false; pace = it }
                }
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
                                effect = effectOf(row.key),
                                alone = used.size > 1,
                                focus = focusKey == row.key,
                                onFocused = { focusKey = null },
                                onChange = { patch, typed ->
                                    typing = typed
                                    removed = null
                                    rows = rows.map { if (it.key == row.key) patch else it }
                                },
                                onRemove = {
                                    typing = false
                                    // The focus goes to the line next to it.
                                    focusKey = (rows.getOrNull(i - 1) ?: rows.getOrNull(i + 1))?.key
                                    removed = row to i
                                    rows = rows.filterNot { it.key == row.key }
                                },
                            )
                        }
                        removed?.let { (row, at) ->
                            Row(
                                Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text("Tirou ${KIND_NOUN.getValue(row.kind).lowercase()}.", color = l.muted, style = MaterialTheme.typography.bodyMedium)
                                TextAction("Desfazer", {
                                    typing = false
                                    focusKey = row.key
                                    removed = null
                                    rows = rows.take(at) + row + rows.drop(at)
                                }, color = l.accent)
                            }
                        }
                        if (refused.isNotEmpty()) {
                            Text(
                                "Não consegui somar ${refused.map { KIND_NOUN.getValue(it.kind).lowercase() }.distinct().joinToString(" e ")}: " +
                                    "${if (refused.size > 1) "ficaram" else "ficou"} de fora. Confira o valor e o dia.",
                                color = l.neg,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                            )
                        }
                        AddButtons(listOf("compra", "entrada", "saida").filter { it != "compra" || v.card != null }, rows.size < MAX_CHANGES, add)
                        when {
                            rows.size >= MAX_CHANGES ->
                                Text("Até $MAX_CHANGES mudanças de cada vez.", color = l.faint, style = MaterialTheme.typography.bodyMedium)
                            v.card == null ->
                                TextAction("Para simular uma compra, escolha o cartão principal em Ajustes ›", onAjustes, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
        }
    }
}

/** The answer in one line, under the bar, while the real one is scrolled away; a tap goes back to it. */
@Composable
private fun Peek(v: ScenarioView, onClick: () -> Unit) {
    val l = LocalLedger.current
    val red = v.firstNegative
    val lowest = v.effect?.lowest
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
            red?.let { "Negativo em ${dayOf(it.date, v.today)}" }
                ?: v.lowest?.let { "Menor saldo ${roundMoney(it.balance)}${if (v.full.isNotEmpty()) " no melhor caso" else ""}" }
                ?: "",
            color = if (red != null) l.neg else l.text,
            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
        )
        if (lowest != null && !none(lowest)) {
            Text("${roundMoney(abs(lowest))} ${if (lowest < 0) "a menos" else "a mais"}", color = l.faint, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/**
 * The answer: the sentence with its premise, what the changes did, the premise's own chips right
 * under it, two figures, the chart and its table.
 */
@Composable
private fun Answer(v: ScenarioView, failed: Boolean, single: String?, onAjustes: () -> Unit, onPick: (String) -> Unit) {
    val l = LocalLedger.current
    val same = v.days.all { it.sim == it.sheet }
    val end = v.months.lastOrNull()
    val endLabel = end?.let { monthLabel(it.year, it.month, v.today) } ?: ""
    var table by rememberSaveable { mutableStateOf(false) }
    val verdict = verdictOf(v)
    val head = headOf(v, single)
    Panel {
        // One heading TalkBack reads again when the answer changes: the sentence and what changed it.
        Column(
            Modifier.semantics(mergeDescendants = true) { heading(); liveRegion = LiveRegionMode.Polite },
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(verdict, style = MaterialTheme.typography.headlineSmall)
            if (head.isNotEmpty()) Text(head, color = l.muted, style = MaterialTheme.typography.bodyMedium)
        }
        PaceBlock(v, onAjustes, onPick)
        Row(Modifier.fillMaxWidth()) {
            if (end != null) {
                Figure(
                    "Fim de $endLabel",
                    roundMoney(end.endSim),
                    if (end.endSim < 0) l.neg else l.text,
                    listOfNotNull(if (v.pace != "planilha" && end.endSim != end.endSheet) "Planilha: ${roundMoney(end.endSheet)}" else null),
                    Modifier.weight(1f),
                )
            }
            val s = v.saving
            Figure(
                "Dá para guardar",
                s?.let { roundMoney(it.amount) } ?: "Nada",
                l.text,
                listOf(
                    when {
                        s != null -> if (s.date == v.today) "hoje" else "em ${dayOf(s.date, v.today)}"
                        v.full.isNotEmpty() -> "as faturas tomam ${if (v.pace == "teto") "o teto" else "a média"}"
                        v.firstNegative != null -> "o saldo fica negativo"
                        else -> "sobra pouco no menor saldo"
                    },
                ),
                Modifier.weight(1f),
                end = true,
            )
        }
        // What saving does to the lowest day, under both figures rather than under one.
        v.saving?.let {
            Text(
                "Guardando esse valor, o menor saldo fica em ${roundMoney(it.leftAtLowest)}.",
                color = l.faint,
                style = MaterialTheme.typography.labelMedium,
            )
        }
        if (failed) Text("Sem conexão: este é o último resultado.", color = l.warn, style = MaterialTheme.typography.bodyMedium)
        if (!same) Legend()
        SimChart(
            v.days, same, v.today, v.firstNegative ?: v.lowest,
            "Saldo de hoje até ${dayOf(v.end, v.today)}. $verdict",
            fit = v.pace != "planilha",
            from = v.paceFrom,
        )
        TextAction("Mês a mês", { table = !table }, open = table)
        if (table) MonthTable(v, same)
    }
}

@Composable
private fun Figure(label: String, value: String, color: Color, notes: List<String>, modifier: Modifier, end: Boolean = false) {
    val l = LocalLedger.current
    val align = if (end) TextAlign.End else TextAlign.Start
    Column(modifier.semantics(mergeDescendants = true) {}, horizontalAlignment = if (end) Alignment.End else Alignment.Start) {
        Text(label, color = l.faint, style = MaterialTheme.typography.labelMedium, textAlign = align)
        Text(value, color = color, style = MaterialTheme.typography.titleLarge, textAlign = align)
        notes.forEach { Text(it, color = l.faint, style = MaterialTheme.typography.labelMedium, textAlign = align) }
    }
}

/** What each line on the chart is; the dashed rule says its own name on the plot. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Legend() {
    val l = LocalLedger.current
    FlowRow(
        Modifier.clearAndSetSemantics {},
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
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
                Text(monthLabel(m.year, m.month, v.today), Modifier.weight(1f), color = l.muted, style = style)
                if (!same) Text(roundMoney(m.endSheet), Modifier.weight(1f), color = if (m.endSheet < 0) l.neg else l.text, style = style, textAlign = TextAlign.End)
                Text(roundMoney(m.endSim), Modifier.weight(1f), color = if (m.endSim < 0) l.neg else l.text, style = style, textAlign = TextAlign.End)
            }
        }
    }
}

/** The premise in one line: the spending of the day to day the months ahead take, and from when. */
internal fun premiseOf(v: ScenarioView, pace: String): String {
    val now = v.today.substring(5, 7).toInt()
    val from = "${capitalize(monthName(now))} segue a planilha; de ${monthName((now % 12) + 1)} em diante"
    val monthly = v.monthly
    return when {
        pace == "planilha" || monthly == null -> "Só o que já está na planilha: os meses à frente ainda sem o gasto do dia a dia."
        pace == "teto" -> "$from, ${roundMoney(monthly)} por mês em cartões e Pix."
        else -> "$from, ${roundMoney(monthly)} por mês, a média dos últimos 3 meses."
    }
}

/** How the premise is counted, and which of the ceiling and the average is the cautious one. */
internal fun howOf(v: ScenarioView, pace: String): String {
    val monthly = v.monthly
    val teto = v.spends.teto
    val media = v.spends.media
    val inside = "As faturas que já estão na planilha ficam dentro dele: cada mês só gasta o que falta para chegar lá. " +
        "Por isso uma compra parcelada que cabe não mexe no saldo; ela deixa menos para o resto do mês."
    return when {
        pace == "planilha" || monthly == null ->
            "Os meses à frente só têm o que já está lançado: salário, contas fixas, parcelas. O gasto do dia a dia ainda não está neles, " +
                "então parecem melhores do que vão ser. Teto e Média somam esse gasto."
        pace == "teto" ->
            "O teto é o que você definiu em Ajustes para cartões e Pix. $inside" +
                when {
                    media == null || media == monthly -> ""
                    media > monthly -> " Nos últimos 3 meses a média foi ${roundMoney(media)}, acima dele: a Média é a conta mais cautelosa."
                    else -> " Nos últimos 3 meses a média foi ${roundMoney(media)}, abaixo dele: esta é a conta mais cautelosa."
                }
        else ->
            "A média soma o diário real e as faturas dos seus cartões nos 3 últimos meses completos. ${inside.replace("dentro dele", "dentro dela")}" +
                when {
                    teto == null || teto == monthly -> ""
                    monthly > teto -> " Passa do teto de ${roundMoney(teto)}: esta é a conta mais cautelosa."
                    else -> " Fica abaixo do teto de ${roundMoney(teto)}: o Teto é a conta mais cautelosa."
                }
    }
}

/** The premise under the answer it decides: chips, one line, and how it is counted on demand. */
@Composable
private fun PaceBlock(v: ScenarioView, onAjustes: () -> Unit, onPick: (String) -> Unit) {
    val l = LocalLedger.current
    var how by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (v.paces.size > 1) {
            ChipGrid(v.paces.map { PACE_LABEL[it] ?: it }, v.paces.indexOf(v.pace)) { onPick(v.paces[it]) }
        }
        Text(premiseOf(v, v.pace), color = l.muted, style = MaterialTheme.typography.bodyMedium)
        val bare = bareOf(v)
        if (bare.isNotEmpty()) {
            // A premise the answer leans on: the tone in one dot, as the alerts carry it.
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.padding(top = 7.dp).size(6.dp).background(l.warn, CircleShape))
                Text(bare, color = l.muted, style = MaterialTheme.typography.bodyMedium)
            }
        }
        if (v.spends.teto == null) {
            TextAction("Para ver gastando o teto, defina o teto do mês em Ajustes ›", onAjustes, style = MaterialTheme.typography.bodyMedium)
        }
        TextAction("Como calculei", { how = !how }, open = how)
        if (how) Text(howOf(v, v.pace), color = l.muted, style = MaterialTheme.typography.bodyMedium)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChangeRow(
    row: SimRow,
    v: ScenarioView,
    /** This line on its own; null while it says too little to count. */
    effect: ScenarioChangeEffect?,
    /** Other lines count too: this one says what it does by itself. */
    alone: Boolean,
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
    Column(Modifier.appear(220).semantics { isTraversalGroup = true }, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // A line's name sits under the panel's "E se…", one step quieter.
            Text(title, color = l.muted, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            // Drawn at the top right, read last: TalkBack meets the value first.
            IconButton(onClick = onRemove, modifier = Modifier.semantics { traversalIndex = 1f }) {
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
        // Two lines at most: when it lands and what it leaves of the plan, then what it does on its
        // own (and what the pace keeps of it); a third only when the sheet ends before the last parcel.
        val last = v.months.lastOrNull()?.let { monthLabel(it.year, it.month, v.today) } ?: monthOf(v.end.take(7), v.today)
        val inside = PACE_INSIDE[v.pace] ?: ""
        val note = buildList {
            if (compra) {
                val first = buildList {
                    v.due?.let { add("${if (row.count > 1) "1ª parcela" else "Sai da conta"} em ${dayOf(it, v.today)}." to l.faint) }
                    v.canSpend?.let { cs ->
                        val fig = simFigure(cs.mode, cs.left, cs.overBy, if (amount != null) v.cycle else null)
                        add(fitText(cs.mode, cs.due, v.today, fig.amount, fig.over) to (if (fig.over) l.neg else l.faint))
                    }
                }
                if (first.isNotEmpty()) add(first)
            } else if (outOfRange) {
                add(listOf("Escolha um dia de hoje até ${dayOf(v.end, v.today)}." to l.neg))
            } else if (row.count > 1) {
                add(listOf("Todo dia ${iso!!.takeLast(2).toInt()}, ${row.count} meses seguidos." to l.faint))
            }
            val own = buildList {
                if (effect != null && alone) add(deltaSentence(effect.lowest, effect.end, "fim", "Sozinha,", false) + ".")
                effect?.inPace?.let { h ->
                    val within = inside.replaceFirstChar { it.uppercase() }
                    add(
                        if (h.count == 1) {
                            "$within de ${monthOf(h.until, v.today)}: ${roundMoney(h.amount)} a menos para o resto do mês."
                        } else {
                            "$within até ${monthOf(h.until, v.today)}: ${if (h.perMonth * h.count == h.amount) "" else "no máximo "}" +
                                "${roundMoney(h.perMonth)} a menos por mês."
                        },
                    )
                }
            }
            if (own.isNotEmpty()) add(listOf(own.joinToString(" ") to l.faint))
            if (effect != null && effect.counted < effect.of) {
                add(listOf("A planilha vai até $last: ${effect.counted} de ${effect.of} ${if (compra) "parcelas entram" else "entram"} na conta." to l.faint))
            }
        }
        if (note.isNotEmpty()) {
            Column(Modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                note.forEach { line ->
                    Text(
                        buildAnnotatedString {
                            line.forEachIndexed { k, (text, color) ->
                                if (k > 0) append(" ")
                                withStyle(SpanStyle(color = color)) { append(text) }
                            }
                        },
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

/** The add buttons side by side while all fit, else one a row: never two and one left over. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AddButtons(kinds: List<String>, enabled: Boolean, onAdd: (String) -> Unit) {
    val measurer = rememberTextMeasurer()
    val style = MaterialTheme.typography.labelLarge
    val density = LocalDensity.current
    // Its label, the icon, the gap and the padding around them.
    val need = kinds.sumOf { with(density) { measurer.measure(KIND_LABEL.getValue(it), style).size.width.toDp() }.value + 42.0 } +
        8.0 * (kinds.size - 1)
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            maxItemsInEachRow = if (need <= maxWidth.value) kinds.size else 1,
        ) {
            kinds.forEach { k -> AddButton(KIND_LABEL.getValue(k), enabled, Modifier.weight(1f)) { onAdd(k) } }
        }
    }
}

@Composable
private fun AddButton(text: String, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val l = LocalLedger.current
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 48.dp),
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
 * what it needs and the rest sharing what is left; as many to a row as fit, the rows even (six
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
        // Only even rows: six as 6, 3 + 3, 2 + 2 + 2; three as 3 or one a row, never 2 + 1.
        val perRow = (labels.size downTo 1)
            .filter { labels.size % it == 0 }
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
 * own, a dot on the day the answer names and a dashed rule where the pace starts to count. With a
 * pace the scale is the simulation's: the sheet runs off the top, an arrow where it leaves. A
 * finger reads any day; the table carries every month's value for TalkBack.
 */
@Composable
private fun SimChart(
    days: List<ScenarioDay>,
    same: Boolean,
    today: String,
    mark: ScenarioPoint?,
    label: String,
    fit: Boolean = false,
    from: String? = null,
) {
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
    val values = (if (fit) emptyList() else days.map { it.sheet }) + days.map { it.sim } + 0L
    val ticks = remember(days, fit) { ticksFor(values.min(), values.max()) }
    // The left side is a gutter for the amounts, so no line ever runs through a label.
    val gutter = ticks.maxOf { measurer.measure(axisMoney(it), small).size.width } + with(density) { 10.dp.toPx() }
    val markAt = mark?.let { m -> days.indexOfFirst { it.date == m.date } } ?: -1
    val fromAt = from?.let { f -> days.indexOfFirst { it.date == f } } ?: -1
    // Where the sheet's rosier line leaves the top, a small arrow says where it went.
    val exitAt = if (same) -1 else days.indexOfFirst { it.sheet > ticks.last() }
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
        if (fromAt > 0) {
            drawLine(
                l.faint, Offset(x(fromAt), padTop), Offset(x(fromAt), bottom), 1.5.dp.toPx(),
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 4.dp.toPx())),
            )
        }
        if (!same) {
            clipRect(top = padTop, bottom = bottom) {
                drawPath(path(days.map { it.sheet.toFloat() }, x, y), l.borderInput, style = line)
            }
        }
        if (exitAt >= 0 && at == null) {
            val text = measurer.measure("↑ planilha", small)
            val cx = x(exitAt).coerceIn(gutter + text.size.width / 2f, size.width - padRight - text.size.width / 2f)
            drawText(text, topLeft = Offset(cx - text.size.width / 2f, padTop - 2.dp.toPx() - text.size.height * 0.85f))
        }
        // Below zero the line itself turns red, not only the wash behind it.
        val sim = path(shown, x, y)
        clipRect(top = 0f, bottom = zero) { drawPath(sim, if (same) l.muted else l.accent, style = line) }
        clipRect(top = zero, bottom = size.height) { drawPath(sim, l.neg, style = line) }
        // Right of the rule the day to day is an assumption: said on the plot, on the panel's color
        // where a line runs through it.
        if (fromAt > 0) {
            val text = measurer.measure("previsão →", small.copy(color = l.muted))
            val tx = min(x(fromAt) + 5.dp.toPx(), size.width - padRight - text.size.width)
            val ty = bottom - 6.dp.toPx() - text.firstBaseline
            val pad = 2.dp.toPx()
            drawRoundRect(
                l.surface, Offset(tx - pad, ty), Size(text.size.width + 2 * pad, text.size.height.toFloat()),
                CornerRadius(3.dp.toPx()),
            )
            drawText(text, topLeft = Offset(tx, ty))
        }
        val ring = 2.dp.toPx()
        // The day the answer names: a dot on the line itself, so a one-day dip still reaches it.
        if (markAt >= 0) {
            val v = shown.getOrElse(markAt) { 0f }
            drawCircle(if (v < 0) l.neg else if (same) l.muted else l.accent, 3.5.dp.toPx(), Offset(x(markAt), y(v)))
        }
        // A month's name at each first day, every second or third month on a narrow screen; the
        // year on the first one when the chart spans more than one, and where it turns.
        val firsts = days.indices.filter { days[it].date.endsWith("-01") }
        val every = ceil(firsts.size / max(2f, floor(plotW / 64.dp.toPx()))).toInt().coerceAtLeast(1)
        var was = if (today.take(4) != days.last().date.take(4)) "" else today.take(4)
        firsts.filterIndexed { k, _ -> k % every == 0 }.forEach { i ->
            val d = days[i].date
            val name = monthName(d.substring(5, 7).toInt()).take(3) + if (d.take(4) == was) "" else " ${d.take(4)}"
            was = d.take(4)
            val text = measurer.measure(name, small)
            drawText(text, topLeft = Offset(x(i) - text.size.width / 2f, size.height - 8.dp.toPx() - text.size.height * 0.8f))
        }
        val i = at ?: return@Canvas
        val d = days[i]
        val cx = x(i)
        drawLine(l.faint, Offset(cx, padTop), Offset(cx, bottom), 1.dp.toPx())
        if (!same && d.sheet <= ticks.last()) {
            drawCircle(l.surface, 4.dp.toPx() + ring, Offset(cx, y(d.sheet.toFloat())))
            drawCircle(l.borderInput, 4.dp.toPx(), Offset(cx, y(d.sheet.toFloat())))
        }
        drawCircle(l.surface, 4.dp.toPx() + ring, Offset(cx, y(d.sim.toFloat())))
        drawCircle(if (d.sim < 0) l.neg else if (same) l.muted else l.accent, 4.dp.toPx(), Offset(cx, y(d.sim.toFloat())))
        // The day read, beside the line on the side with more room, so it never covers the dots.
        val lines = buildList {
            add(measurer.measure(dayOf(d.date, today), tip.copy(color = l.faint)))
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
