package dev.johnlaff.neko.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withAnnotation
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.ApiException
import dev.johnlaff.neko.data.Mia2Ask
import dev.johnlaff.neko.data.Mia2Grafico
import dev.johnlaff.neko.data.Mia2Line
import dev.johnlaff.neko.data.Mia2Valor
import dev.johnlaff.neko.data.MiaStatus
import dev.johnlaff.neko.ui.Format.shortDate
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

/** Questions that show what she does now: sums, charts, the future as a simulation (the site's MIA2_TOPICS). */
private val MIA2_TOPICS = mapOf(
    "hoje" to listOf("Quanto ainda cabe este mês?", "Como foram meus últimos 6 meses?"),
    "faturas" to listOf("Quanto vem nas próximas faturas?", "Mostra as faturas dos próximos meses"),
    "mes" to listOf("Este mês está melhor que o anterior?", "Quanto gastei com mercado este ano?"),
)
private const val ANY = "E se eu comprar algo de R$ 2.000 em 10x?"

/** Four questions, those about the screen she was opened from first. */
fun mia2Starters(topic: String = "hoje"): List<String> =
    (MIA2_TOPICS[topic].orEmpty() + ANY + MIA2_TOPICS.values.flatten()).distinct().take(4)

/** A question as asked, whatever its case or closing mark, so a typed one is not suggested again. */
private fun same(q: String) = q.lowercase().replace(Regex("""[\s?!.]+$"""), "")

fun mia2NotAsked(asked: List<String>): (String) -> Boolean = { q -> asked.none { same(it) == same(q) } }

/** After an answer, two questions not asked yet. */
fun mia2Next(asked: List<String>, topic: String = "hoje"): List<String> =
    (mia2Starters(topic) + MIA2_TOPICS.values.flatten()).distinct().filter(mia2NotAsked(asked)).take(2)

/** A piece of her answer: text (values checked once it is whole) or a chart. */
sealed interface Mia2Part {
    val id: String
}

/** Her text; `valores` is null while it is still coming, its values not checked yet. */
data class Mia2Texto(override val id: String, val texto: String, val valores: Map<String, Mia2Valor>?) : Mia2Part

data class Mia2Desenho(override val id: String, val grafico: Mia2Grafico) : Mia2Part

/** One question and her answer; `end` says how it ended when it did not simply end ("parou", "cheia", "falhou"). */
data class Mia2Turno(val n: Int, val pergunta: String, val parts: List<Mia2Part> = emptyList(), val end: String? = null)

/** The Worker's two calls for her: the answer as it streams, and Stop. */
interface Mia2Talk {
    fun ask(ask: Mia2Ask): Flow<Mia2Line>
    suspend fun stop(sessao: String)
}

/**
 * The conversation with her agent, kept by the app (the site's Chat): leaving to check a month and
 * coming back finds it as it was, an answer still coming included.
 */
class Mia2Chat {
    var sessao by mutableStateOf<String?>(null)
    var turns by mutableStateOf(emptyList<Mia2Turno>())
    /** The question being answered. */
    var pending by mutableStateOf<Int?>(null)
    var sentAt by mutableStateOf(0L)
    /** What she is doing, while she is not writing. */
    var status by mutableStateOf<String?>(null)
    var limited by mutableStateOf(false)
    var typed by mutableStateOf("")
    var typing by mutableStateOf(false)
    /** A question sent while she answers: it goes when she is done. */
    var held by mutableStateOf(false)
    /** The conversation "Nova conversa" just cleared, for Desfazer while it shows. */
    var cleared by mutableStateOf<Pair<String?, List<Mia2Turno>>?>(null)
    private var job: Job? = null

    private fun patch(n: Int, fn: (Mia2Turno) -> Mia2Turno) {
        turns = turns.map { if (it.n == n) fn(it) else it }
    }

    private fun putText(t: Mia2Turno, id: String, texto: String, valores: Map<String, Mia2Valor>?): Mia2Turno {
        val part = Mia2Texto(id, texto, valores)
        val at = t.parts.indexOfFirst { it is Mia2Texto && it.id == id }
        return if (at < 0) t.copy(parts = t.parts + part) else t.copy(parts = t.parts.mapIndexed { i, p -> if (i == at) part else p })
    }

    /** One line of the answer to question [n]; true when it ends the answer, thrown when it failed. */
    fun take(n: Int, l: Mia2Line): Boolean {
        when (l.t) {
            "sessao" -> sessao = l.id
            "status" -> status = l.texto
            "parcial", "mensagem" -> {
                status = null
                patch(n) { putText(it, l.id.orEmpty(), l.texto.orEmpty(), if (l.t == "mensagem") l.valores.orEmpty() else null) }
            }
            "grafico" -> {
                status = null
                val g = l.grafico ?: return false
                patch(n) { it.copy(parts = it.parts + Mia2Desenho(l.id.orEmpty(), g)) }
            }
            "refazendo" -> patch(n) { it.copy(parts = emptyList()) }
            "fim" -> return true
            "erro" -> {
                if (l.motivo == "limite_conversa") {
                    patch(n) { it.copy(end = "cheia") }
                    return true
                }
                // The month's cap: she rests, and the question goes with the answer she could not give.
                if (l.motivo == "limite_mes") limited = true
                throw IOException(l.motivo ?: "falha")
            }
        }
        return false
    }

    fun ask(pergunta: String, scope: CoroutineScope, talk: Mia2Talk) {
        if (pending != null) return
        val n = (turns.lastOrNull()?.n ?: -1) + 1
        turns = turns + Mia2Turno(n, pergunta)
        pending = n
        sentAt = System.currentTimeMillis()
        status = null
        typed = ""
        cleared = null
        job = scope.launch {
            try {
                var ended = false
                talk.ask(Mia2Ask(pergunta, sessao)).collect { if (take(n, it)) ended = true }
                if (!ended) throw IOException("cortada")
            } catch (c: CancellationException) {
                throw c
            } catch (e: Throwable) {
                if (limited || (e is ApiException && e.status == 429)) {
                    // The month's cap: she rests, and the question goes with the answer she could not give.
                    limited = true
                    turns = turns.filterNot { it.n == n }
                } else {
                    // The question stays where it was asked, with "Tentar de novo" under it; a half answer goes.
                    patch(n) { it.copy(parts = emptyList(), end = "falhou") }
                }
            } finally {
                if (pending == n) {
                    pending = null
                    status = null
                    // The question sent while she answered goes now, after an answer that ended well.
                    val next = typed.trim()
                    if (held && turns.lastOrNull()?.end == null && next.isNotEmpty()) {
                        held = false
                        ask(next, scope, talk)
                    }
                    held = false
                }
            }
        }
    }

    /** Stops her answer: what she wrote stays, marked as stopped. */
    fun stop(scope: CoroutineScope, talk: Mia2Talk) {
        val n = pending ?: return
        job?.cancel()
        sessao?.let { s -> scope.launch { runCatching { talk.stop(s) } } }
        patch(n) { it.copy(end = "parou") }
        pending = null
        status = null
        held = false
    }

    /** Asks again, in its place, a question that got no answer or whose answer was stopped. */
    fun retry(scope: CoroutineScope, talk: Mia2Talk) {
        val t = turns.lastOrNull() ?: return
        if ((t.end != "falhou" && t.end != "parou") || pending != null) return
        turns = turns.dropLast(1)
        ask(t.pergunta, scope, talk)
    }

    fun clear() {
        if (pending != null) return
        cleared = if (turns.isEmpty()) null else sessao to turns
        turns = emptyList()
        sessao = null
    }

    /** Brings back the conversation "Nova conversa" cleared. */
    fun undoClear() {
        val (s, t) = cleared ?: return
        if (pending != null) return
        sessao = s
        turns = t
        cleared = null
    }
}

/** A block of her text: a paragraph of lines, or a list. */
data class Mia2Block(val list: Boolean, val lines: List<String>)

/** Her text in short paragraphs and lists, nothing richer (the site's Rich): no headings, no tables. */
fun mia2Blocks(texto: String): List<Mia2Block> {
    // A bold still being written shows plain until it closes.
    val whole = if (Regex("""\*\*""").findAll(texto).count() % 2 == 1) {
        val at = texto.lastIndexOf("**")
        texto.removeRange(at, at + 2)
    } else texto
    val out = mutableListOf<Pair<Boolean, MutableList<String>>>()
    for (raw in whole.split("\n")) {
        val line = raw.trim().replace(Regex("""^#+\s*"""), "")
        val open = out.lastOrNull()
        if (line.isEmpty()) {
            if (open != null && open.second.isNotEmpty()) out += false to mutableListOf()
            continue
        }
        val item = Regex("""^([-•*]|\d+[.)])\s+""").find(line)
        val text = if (item != null) line.substring(item.value.length) else line
        val list = item != null
        when {
            open != null && open.second.isEmpty() -> out[out.lastIndex] = list to mutableListOf(text)
            open != null && open.first == list -> open.second += text
            else -> out += list to mutableListOf(text)
        }
    }
    return out.filter { it.second.isNotEmpty() }.map { Mia2Block(it.first, it.second) }
}

private val BOLD = Regex("""\*\*(.+?)\*\*""")
/** Any R$ while the text is still coming: plain until its values are checked. */
private val LOOSE_MONEY = Regex("""[−-]?\s?R\$\s?[−-]?\s?[\d.,]*\d""")
private const val LOOSE = "loose"

/** The screens an answer's checked values came from, two at most, as quiet ways out. */
fun mia2Sources(t: Mia2Turno): List<MiaSource> =
    t.parts.filterIsInstance<Mia2Texto>()
        .flatMap { it.valores.orEmpty().values }
        .filter { it.conferido && (it.tela == "faturas" || it.tela == "mes") }
        .distinctBy { it.tela to it.mes }
        .map { v ->
            val label = when {
                v.tela == "faturas" -> "Ver faturas"
                v.mes != null -> "Ver ${Format.monthName(v.mes.drop(5).take(2).toInt())}"
                else -> "Ver o mês"
            }
            MiaSource(v.tela!!, v.mes, label)
        }
        .take(2)

/** The values of one piece of her text that came from nowhere. */
fun mia2Loose(p: Mia2Texto): List<String> = p.valores.orEmpty().filterValues { !it.conferido }.keys.toList()

/** Whether a stopped answer has values she never got to check. */
fun mia2StoppedValues(t: Mia2Turno): Boolean =
    t.end == "parou" && t.parts.any { it is Mia2Texto && it.valores == null && LOOSE_MONEY.containsMatchIn(it.texto) }

/**
 * Mia 2's screen (the site's Mia2Screen): the first Mia's page, her answer written as it comes,
 * charts in the conversation, every R$ checked against the Neko's numbers, and Stop while she works.
 */
@Composable
fun Mia2Screen(
    status: MiaStatus?,
    talk: Mia2Talk,
    chat: Mia2Chat,
    scope: CoroutineScope,
    onBack: () -> Unit,
    onScreen: (String) -> Unit,
    onMonth: (String?) -> Unit = { onScreen("mes") },
    topic: String = "hoje",
) {
    val l = LocalLedger.current
    val focus = LocalFocusManager.current
    val density = LocalDensity.current
    val input = remember { FocusRequester() }
    val list = rememberLazyListState()
    var seconds by remember { mutableStateOf(0) }
    DisposableEffect(Unit) { onDispose { chat.typing = false } }
    LaunchedEffect(chat.pending) {
        while (chat.pending != null) {
            seconds = ((System.currentTimeMillis() - chat.sentAt) / 1000).toInt()
            delay(1000)
        }
        seconds = 0
    }
    val paused = status?.pausadaAte
    val on = status?.ligada == true
    val resting = paused != null || chat.limited
    val lead = if (on && paused != null && !chat.limited) 1 else 0
    val open = { tela: String, mes: String? -> if (tela == "mes") onMonth(mes) else onScreen(tela) }
    val turns = chat.turns
    val send = { q: String ->
        if (q.isNotBlank() && chat.pending == null) chat.ask(q.trim(), scope, talk)
    }
    // A question just sent shows at the top; the answer then grows under it, never scrolled away.
    LaunchedEffect(chat.pending) {
        val n = chat.pending ?: return@LaunchedEffect
        val at = turns.indexOfFirst { it.n == n }
        if (at >= 0) list.animateScrollToItem(lead + at)
    }
    // An answer done closes the keyboard it was asked from, so the answer shows; never while the next
    // question is being typed, nor after Parar, which hands the field back.
    LaunchedEffect(chat.pending == null) {
        if (chat.pending == null && chat.typing && turns.isNotEmpty() && chat.typed.isBlank() && turns.last().end != "parou") focus.clearFocus()
    }
    // Desfazer after "Nova conversa" stays a few seconds, as after a launch.
    val a11y = androidx.compose.ui.platform.LocalAccessibilityManager.current
    LaunchedEffect(chat.cleared) {
        if (chat.cleared == null) return@LaunchedEffect
        delay(a11y?.calculateRecommendedTimeoutMillis(UNDO_MS, containsIcons = false, containsText = true, containsControls = true) ?: UNDO_MS)
        chat.cleared = null
    }
    // Parar takes Enviar's place: a second tap on Enviar right after it is not a stop.
    val halt = {
        if (chat.pending != null && System.currentTimeMillis() - chat.sentAt >= 600) {
            chat.stop(scope, talk)
            runCatching { input.requestFocus() }
        }
    }
    val full = turns.lastOrNull()?.end == "cheia"
    val doing = chat.status ?: if (chat.pending?.let { n -> turns.firstOrNull { it.n == n }?.parts?.isEmpty() } == true) miaWaiting(seconds) else null
    val asked = turns.map { it.pergunta }
    val next = if (turns.isEmpty() || resting || full || chat.typed.isNotBlank() || chat.pending != null) emptyList() else mia2Next(asked, topic)

    Column(
        Modifier.fillMaxSize().background(l.bg).safeDrawingPadding().semantics { paneTitle = "Mia" },
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
                MiaMark(28.dp)
                Text("Mia", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f).semantics { heading() })
                // Stays put while an answer is on its way, so the bar does not jump; usable again after.
                if (turns.isNotEmpty()) {
                    // A way out, not the next step: quiet beside her name, the answer keeps the eye.
                    TextAction("Nova conversa", enabled = chat.pending == null, color = if (chat.pending == null) l.muted else l.faint, onClick = {
                        chat.clear()
                        if (on && !resting) runCatching { input.requestFocus() }
                    })
                }
            }
            HorizontalDivider(color = l.border)
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                state = list,
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                if (status != null && !on) item(key = "off") {
                    Text("A Mia não está ligada neste Neko.", color = l.muted)
                }
                if (on && lead == 1 && paused != null) item(key = "lead") {
                    Text("A Mia descansa até ${shortDate(paused)}. Os números seguem nas telas.", color = l.muted)
                }
                val cleared = chat.cleared
                if (cleared != null && turns.isEmpty()) item(key = "cleared") {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .background(l.text, RoundedCornerShape(12.dp))
                            .padding(start = 16.dp, end = 8.dp, top = 4.dp, bottom = 4.dp)
                            .semantics { liveRegion = LiveRegionMode.Polite },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Conversa apagada", Modifier.weight(1f), color = l.bg, style = MaterialTheme.typography.bodyMedium)
                        TextAction("Desfazer", { chat.undoClear() }, l.bg)
                    }
                }
                if (on && turns.isEmpty() && chat.pending == null) item(key = "empty") {
                    Column(Modifier.padding(top = 56.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(miaTitle(topic), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
                        Text(
                            "Ela lê o Neko, faz as contas e mostra gráficos. Não muda a planilha.",
                            color = l.muted,
                            modifier = Modifier.padding(bottom = 12.dp),
                        )
                        if (!resting) mia2Starters(topic).filter(mia2NotAsked(asked)).forEach { q -> Suggestion(q, wrap = true) { send(q) } }
                    }
                }
                items(turns, key = { "t${it.n}" }) { t ->
                    val newest = t.n == turns.last().n
                    val working = chat.pending == t.n
                    // The newest question keeps a screen's room under it: sent, it rises under the bar
                    // and her answer grows in view above the field, never behind it.
                    val room = with(density) { list.layoutInfo.viewportSize.height.toDp() } - 32.dp
                    Box(if (newest) Modifier.heightIn(min = room.coerceAtLeast(0.dp)) else Modifier) {
                        Mia2TurnItem(
                            t,
                            working,
                            if (newest && !working) mia2Sources(t) else emptyList(),
                            open,
                            doing = if (working) doing else null,
                            onRetry = if (newest && !resting) ({ chat.retry(scope, talk) }) else null,
                            onNew = if (newest) ({
                                chat.clear()
                                runCatching { input.requestFocus() }
                            }) else null,
                        )
                    }
                }
                if (chat.limited) item(key = "limited") {
                    Text(
                        "A Mia descansa até o mês que vem. Os números seguem nas telas.",
                        color = l.muted,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
            }
            if (on && !resting && !full) {
                HorizontalDivider(color = l.border)
                Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (chat.held && chat.pending != null) {
                        Text(
                            "Sua pergunta vai quando ela terminar.",
                            color = l.muted,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                        )
                    }
                    if (next.isNotEmpty() && !chat.typing) {
                        Row(
                            Modifier
                                .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                                .drawWithContent {
                                    drawContent()
                                    drawRect(Brush.horizontalGradient(0.88f to Color.Black, 1f to Color.Transparent), blendMode = BlendMode.DstIn)
                                }
                                .horizontalScroll(key(turns.size) { rememberScrollState() }),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            next.forEach { q -> Suggestion(q) { send(q) } }
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = chat.typed,
                            onValueChange = {
                                chat.typed = it.take(1000)
                                if (it.isBlank()) chat.held = false
                            },
                            singleLine = true,
                            placeholder = { Text(if (turns.isEmpty()) "Pergunte algo" else "Outra pergunta?", color = l.faint) },
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                            // While she answers, Send keeps the next question for when she is done.
                            keyboardActions = KeyboardActions(onSend = {
                                if (chat.pending == null) send(chat.typed) else if (chat.typed.isNotBlank()) chat.held = true
                            }),
                            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = l.accent, unfocusedBorderColor = l.borderInput),
                            modifier = Modifier
                                .weight(1f)
                                .focusRequester(input)
                                .onFocusChanged { chat.typing = it.isFocused }
                                .semantics { contentDescription = "Pergunta para a Mia" },
                        )
                        // While she works, Send becomes Stop, outlined so it never reads as a second Send.
                        if (chat.pending != null) {
                            OutlinedButton(
                                onClick = halt,
                                border = BorderStroke(1.dp, l.borderInput),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = l.text),
                                shape = RoundedCornerShape(10.dp),
                            ) { Text("Parar", style = MaterialTheme.typography.labelLarge) }
                        } else {
                            Button(
                                onClick = { send(chat.typed) },
                                enabled = chat.typed.isNotBlank(),
                                colors = ButtonDefaults.buttonColors(containerColor = l.text, contentColor = l.bg),
                                shape = RoundedCornerShape(10.dp),
                            ) { Text("Enviar", style = MaterialTheme.typography.labelLarge) }
                        }
                    }
                }
            }
        }
    }
}

/** One question as a quiet bubble to the right, her answer under it: text, charts, notes, ways out. */
@Composable
private fun Mia2TurnItem(
    t: Mia2Turno,
    working: Boolean,
    sources: List<MiaSource>,
    open: (String, String?) -> Unit,
    /** What she is doing while she works, under what she wrote so far. */
    doing: String?,
    onRetry: (() -> Unit)?,
    onNew: (() -> Unit)?,
) {
    val l = LocalLedger.current
    val first = t.parts.firstOrNull { it is Mia2Texto }?.id
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            t.pergunta,
            color = l.text,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier
                .align(Alignment.End)
                .fillMaxWidth(0.85f)
                .wrapContentWidth(Alignment.End)
                .background(l.surface2, RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp))
                .padding(horizontal = 14.dp, vertical = 8.dp),
        )
        // Read aloud once it is whole, not word by word as it comes.
        Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
            Column(
                (if (working) Modifier.clearAndSetSemantics {} else Modifier),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                t.parts.forEach { p ->
                    key(p.id) {
                        when (p) {
                            is Mia2Texto -> {
                                Mia2Rich(p, open, lead = p.id == first, stopped = t.end == "parou" && p.valores == null)
                                val loose = if (working) emptyList() else mia2Loose(p)
                                if (loose.isNotEmpty()) LooseNote(loose)
                            }
                            is Mia2Desenho -> MiaChart(p.grafico)
                        }
                    }
                }
            }
        }
        if (working) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // The amber is the "confira" mark's on this screen: her wait is neutral ink.
                WaitDots(l.faint)
                Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                    if (doing != null) Text(doing, color = l.muted, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        if (t.end == "parou") {
            Note(if (mia2StoppedValues(t)) "Você parou esta resposta. Os valores não foram conferidos." else "Você parou esta resposta.")
            onRetry?.let { TextAction("Perguntar de novo", it, color = l.accent) }
        }
        if (t.end == "falhou") {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "A Mia não respondeu. Confira a internet e tente de novo.",
                    color = l.muted,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f, fill = false).semantics { liveRegion = LiveRegionMode.Polite },
                )
                onRetry?.let { TextAction("Tentar de novo", it, color = l.accent) }
            }
        }
        if (t.end == "cheia") {
            Note("Esta conversa ficou longa demais. Comece uma nova para continuar.")
            onNew?.let { TextAction("Nova conversa", it, color = l.accent) }
        }
        if (sources.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                sources.forEach { src -> TextAction("${src.label} ›", { open(src.tela, src.mes) }, color = l.accent) }
            }
        }
    }
}

/** Right under the text that holds them: the values that came from nowhere, marked the same way. */
@Composable
private fun LooseNote(loose: List<String>) {
    val text = buildAnnotatedString {
        loose.forEachIndexed { i, v ->
            if (i > 0) append(", ")
            withAnnotation(LOOSE, v) { append(v.replace(' ', '\u00A0')) }
        }
        append(if (loose.size > 1) " não estão" else " não está")
        append(" nos números do Neko. Confira antes de usar.")
    }
    ValueText(text, MaterialTheme.typography.bodyMedium)
}

/** A quiet line under the answer. */
@Composable
private fun Note(text: String) {
    Text(text, color = LocalLedger.current.muted, style = MaterialTheme.typography.bodyMedium)
}

/** Her text: paragraphs and lists, the main number in bold, each value as checked. */
@Composable
private fun Mia2Rich(p: Mia2Texto, open: (String, String?) -> Unit, lead: Boolean, stopped: Boolean = false) {
    val l = LocalLedger.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        mia2Blocks(p.texto).forEachIndexed { k, b ->
            if (b.list) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    b.lines.forEach { line ->
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("•", color = l.faint, style = MaterialTheme.typography.bodyLarge)
                            ValueText(inline(line, p.valores, open, stopped), MaterialTheme.typography.bodyLarge)
                        }
                    }
                }
            } else {
                // Her first paragraph is the answer, set in the book serif like every verdict in the Neko.
                ValueText(
                    buildAnnotatedString {
                        b.lines.forEachIndexed { i, line ->
                            if (i > 0) append("\n")
                            append(inline(line, p.valores, open, stopped))
                        }
                    },
                    if (lead && k == 0) MaterialTheme.typography.bodyLarge.copy(fontFamily = Faustina, fontSize = 19.sp, lineHeight = 27.sp)
                    else MaterialTheme.typography.bodyLarge,
                )
            }
        }
    }
}

/** One line of her text with **bold** and each R$ as written: a link when checked, dotted when not. */
@Composable
private fun inline(line: String, valores: Map<String, Mia2Valor>?, open: (String, String?) -> Unit, stopped: Boolean = false): AnnotatedString {
    val l = LocalLedger.current
    val link = TextLinkStyles(SpanStyle(color = l.text, textDecoration = TextDecoration.Underline))
    val money = if (valores.isNullOrEmpty()) LOOSE_MONEY else Regex(valores.keys.sortedByDescending { it.length }.joinToString("|") { Regex.escape(it) })
    return buildAnnotatedString {
        fun part(s: String, bold: Boolean) {
            val style = if (bold) SpanStyle(fontWeight = FontWeight.SemiBold) else SpanStyle()
            withStyle(style) {
                var at = 0
                money.findAll(s).forEach { m ->
                    append(s.substring(at, m.range.first))
                    val v = valores?.get(m.value)
                    // An amount never breaks from its R$.
                    val shown = m.value.replace(' ', '\u00A0')
                    when {
                        // A stopped answer's values were never checked: dotted like any loose value.
                        v == null -> if (stopped) withAnnotation(LOOSE, m.value) { append(shown) } else append(shown)
                        !v.conferido -> withAnnotation(LOOSE, m.value) { append(shown) }
                        v.tela == "faturas" || v.tela == "mes" ->
                            withLink(LinkAnnotation.Clickable(m.value, link) { open(v.tela, v.mes) }) { append(shown) }
                        else -> append(shown)
                    }
                    at = m.range.last + 1
                }
                append(s.substring(at))
            }
        }
        var at = 0
        BOLD.findAll(line).forEach { m ->
            part(line.substring(at, m.range.first), false)
            part(m.groupValues[1], true)
            at = m.range.last + 1
        }
        part(line.substring(at), false)
    }
}

/** Text whose unchecked values get a dotted amber underline, drawn under each line they run on. */
@Composable
private fun ValueText(text: AnnotatedString, style: TextStyle) {
    val l = LocalLedger.current
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val loose = text.getStringAnnotations(LOOSE, 0, text.length)
    Text(
        text,
        color = l.text,
        style = style,
        onTextLayout = { layout = it },
        modifier = if (loose.isEmpty()) Modifier else Modifier.drawBehind {
            val lay = layout ?: return@drawBehind
            val dots = PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 2.dp.toPx()))
            loose.forEach { a ->
                var from = a.start
                while (from < a.end) {
                    val row = lay.getLineForOffset(from)
                    val to = minOf(a.end, lay.getLineEnd(row, visibleEnd = true))
                    if (to <= from) break
                    val y = lay.getLineBaseline(row) + 4.dp.toPx()
                    val x0 = lay.getBoundingBox(from).left
                    val x1 = lay.getBoundingBox(to - 1).right
                    drawLine(l.warn, Offset(x0, y), Offset(x1, y), 2.dp.toPx(), StrokeCap.Butt, dots)
                    from = to
                }
            }
        },
    )
}
