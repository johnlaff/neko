package dev.johnlaff.neko.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.withFrameNanos
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.ui.platform.LocalContext
import android.provider.Settings
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
import androidx.core.content.edit
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.ApiException
import dev.johnlaff.neko.data.Mia2Ask
import dev.johnlaff.neko.data.Mia2Grafico
import dev.johnlaff.neko.data.Mia2Line
import dev.johnlaff.neko.data.Mia2Numero
import dev.johnlaff.neko.data.Mia2Rotina
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

/** A piece of her answer: text (values checked once it is whole), a chart or a board of numbers. */
sealed interface Mia2Part {
    val id: String
}

/** Her text; `valores` is null while it is still coming, its values not checked yet. */
data class Mia2Texto(override val id: String, val texto: String, val valores: Map<String, Mia2Valor>?) : Mia2Part

data class Mia2Desenho(override val id: String, val grafico: Mia2Grafico) : Mia2Part

/** Her board: two to four numbers side by side, every one checked by the Worker. */
data class Mia2Numeros(override val id: String, val numeros: List<Mia2Numero>) : Mia2Part

/**
 * One question and her answer; `end` says how it ended when it did not simply end ("parou", "cheia",
 * "falhou"). A routine of hers has its name for a question and its day in `rotina`.
 */
data class Mia2Turno(
    val n: Int,
    val pergunta: String,
    val parts: List<Mia2Part> = emptyList(),
    val end: String? = null,
    val rotina: String? = null,
)

/** The Worker's calls for her: the answer as it streams, Stop, and the routine she left by herself. */
interface Mia2Talk {
    fun ask(ask: Mia2Ask): Flow<Mia2Line>
    suspend fun stop(sessao: String)
    /** Her latest routine not shown yet, or null. */
    suspend fun routine(): Mia2Rotina? = null
    /** It was shown: it never takes the screen again. */
    fun routineShown(id: String) {}
}

/** Which routine of hers took her screen last, so each does it once. */
interface RoutineSeen {
    var last: String?

    class InMemory : RoutineSeen {
        override var last: String? = null
    }

    /** In the app's preferences: one shown stays shown after the app is closed. */
    class Stored(context: Context) : RoutineSeen {
        private val prefs = context.getSharedPreferences("mia2", Context.MODE_PRIVATE)
        override var last: String?
            get() = prefs.getString("rotina", null)
            set(value) = prefs.edit { putString("rotina", value) }
    }
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
    /**
     * Her texts and boards already shown in full, by turn and piece: they never come word by word
     * again, not scrolled back to, nor after Desfazer. A new conversation, or a question asked again
     * in its place, starts them over.
     */
    val seen = HashSet<String>()
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
            "numeros" -> {
                status = null
                val ns = l.numeros ?: return false
                patch(n) { it.copy(parts = it.parts + Mia2Numeros(l.id.orEmpty(), ns)) }
            }
            "refazendo" -> patch(n) { it.copy(parts = emptyList()) }
            "fim" -> return true
            "erro" -> {
                if (l.motivo == "limite_conversa") {
                    patch(n) { it.copy(end = "cheia") }
                    return true
                }
                // The month's cap: she rests until next month.
                if (l.motivo == "limite_mes") limited = true
                throw Mia2Failed(l.motivo ?: "falha")
            }
        }
        return false
    }

    fun ask(pergunta: String, scope: CoroutineScope, talk: Mia2Talk) {
        if (pending != null) return
        val n = (turns.lastOrNull()?.n ?: -1) + 1
        if (turns.isEmpty()) seen.clear() else seen.removeAll { it.startsWith("$n:") }
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
                    // The month's cap: she rests, and the question stays to be asked when she is back.
                    limited = true
                    patch(n) { it.copy(parts = emptyList(), end = "descansa") }
                } else {
                    // The question stays where it was asked, with "Tentar de novo" under it; a half answer
                    // goes. She said she could not finish (falhou), or the connection dropped (rede).
                    patch(n) { it.copy(parts = emptyList(), end = if (e is Mia2Failed) "falhou" else "rede") }
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
        if (t.end !in setOf("falhou", "rede", "parou") || pending != null) return
        turns = turns.dropLast(1)
        ask(t.pergunta, scope, talk)
    }

    fun clear() {
        if (pending != null) return
        cleared = if (turns.isEmpty()) null else sessao to turns
        turns = emptyList()
        sessao = null
    }

    /**
     * Her routine becomes the conversation (one that was open goes to Desfazer, as with "Nova
     * conversa"), and the next question goes on in it. Not while she answers.
     */
    fun takeRoutine(r: Mia2Rotina): Boolean {
        if (pending != null) return false
        val parts = r.partes.mapNotNull { p ->
            when (p.t) {
                "mensagem" -> Mia2Texto(p.id.orEmpty(), p.texto.orEmpty(), p.valores.orEmpty())
                "grafico" -> p.grafico?.let { Mia2Desenho(p.id.orEmpty(), it) }
                "numeros" -> p.numeros?.let { Mia2Numeros(p.id.orEmpty(), it) }
                else -> null
            }
        }
        cleared = if (turns.isEmpty()) null else sessao to turns
        seen.clear()
        sessao = r.sessao
        turns = listOf(Mia2Turno(0, r.titulo, parts, rotina = r.dia))
        return true
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

/** Her own word that she could not finish an answer: the connection itself was fine. */
class Mia2Failed(motivo: String) : IOException(motivo)

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
// Like the checked keys, it takes no space before it, so a value keeps its place when checked.
private val LOOSE_MONEY = Regex("""(?:[−-]\s?)?R\$\s?[−-]?\s?[\d.,]*\d""")
private const val LOOSE = "loose"

/**
 * Her board: two to four numbers, two to a row so four read as a square, all in one row with room.
 * Each counts up from zero as it arrives (an answer already read shows still). Plain, not links:
 * where they came from is in the ways out under the answer.
 */
@Composable
private fun Mia2Board(numeros: List<Mia2Numero>, count: Boolean) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val per = if (maxWidth >= 600.dp) numeros.size else 2
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            numeros.chunked(per).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    row.forEach { Mia2Figure(it, count, Modifier.weight(1f)) }
                    repeat(per - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun Mia2Figure(x: Mia2Numero, count: Boolean, modifier: Modifier) {
    val l = LocalLedger.current
    val cents = Math.round(x.valor * 100)
    val shown = counted(cents, fromZero = count)
    Column(modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(x.rotulo, color = l.faint, style = MaterialTheme.typography.labelMedium)
        Text(
            Format.money(shown),
            color = if (cents < 0) l.neg else l.text,
            style = MaterialTheme.typography.titleLarge.copy(fontFeatureSettings = "tnum"),
            modifier = Modifier.clearAndSetSemantics { contentDescription = Format.money(cents) },
        )
        x.nota?.let { Text(it, color = l.faint, style = MaterialTheme.typography.labelMedium) }
    }
}

/** The screens an answer's checked values came from, two at most, as quiet ways out. */
fun mia2Sources(t: Mia2Turno): List<MiaSource> =
    t.parts
        .flatMap { p ->
            when (p) {
                is Mia2Texto -> p.valores.orEmpty().values.toList()
                is Mia2Numeros -> p.numeros.map { Mia2Valor(true, it.tela, it.mes) }
                else -> emptyList()
            }
        }
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
    // Questions asked while the screen is open: only their answers move; the rest were read.
    val here = remember { mutableSetOf<Int>() }
    chat.pending?.let { here += it }
    // Still when the phone asks for no animations.
    val resolver = LocalContext.current.contentResolver
    val still = remember { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
    // Her texts still showing word by word: what comes after an answer waits for them.
    val moving = remember { mutableStateListOf<String>() }
    val send = { q: String ->
        if (q.isNotBlank() && chat.pending == null) chat.ask(q.trim(), scope, talk)
    }
    // Her routine, the first time her screen opens after it came.
    LaunchedEffect(Unit) {
        val r = runCatching { talk.routine() }.getOrNull() ?: return@LaunchedEffect
        if (chat.takeRoutine(r)) talk.routineShown(r.id)
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
    val next = if (turns.isEmpty() || resting || full || chat.typed.isNotBlank() || chat.pending != null || moving.isNotEmpty()) emptyList() else mia2Next(asked, topic)

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
                            "Ela lê o Neko, faz as contas e mostra gráficos. Não muda a planilha. Valores sublinhados levam à tela de onde vieram.",
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
                            if (newest && !working && moving.isEmpty()) mia2Sources(t) else emptyList(),
                            open,
                            fresh = t.n in here,
                            paced = t.n in here && !still,
                            still = still,
                            moving = moving,
                            seen = chat.seen,
                            doing = if (working) doing else null,
                            onRetry = if (newest && !resting) ({ chat.retry(scope, talk) }) else null,
                            onNew = if (newest) ({
                                chat.clear()
                                runCatching { input.requestFocus() }
                            }) else null,
                        )
                    }
                }
                if (chat.limited && turns.lastOrNull()?.end != "descansa") item(key = "limited") {
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
                    if (next.isNotEmpty() && !chat.typing) key(turns.size) {
                        Row(
                            Modifier
                                .rise()
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
                                // The theme's text styles carry a color, which would win over the button's: dark on light
                                // when it can send, faded when it cannot.
                            ) { Text("Enviar", style = MaterialTheme.typography.labelLarge.copy(color = Color.Unspecified)) }
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
    /** Asked while the screen is open: the question rises into place. */
    fresh: Boolean = false,
    /** Her words come at reading pace (not an answer already read). */
    paced: Boolean = false,
    still: Boolean = false,
    moving: SnapshotStateList<String> = remember { mutableStateListOf() },
    /** What was shown in full once, never to come word by word again ([Mia2Chat.seen]). */
    seen: MutableSet<String> = remember { HashSet() },
) {
    val l = LocalLedger.current
    val first = t.parts.firstOrNull { it is Mia2Texto }?.id
    // Her pieces come in order: a chart, or her next text, waits for the words before it.
    val at = t.parts.indexOfFirst { "${t.n}:${it.id}" in moving }
    val parts = if (at < 0) t.parts else t.parts.take(at + 1)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // Her routine stands where a question would: its name and day, on her side, not a bubble.
        if (t.rotina != null) Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(t.pergunta) }
                append(" · ${Format.shortDate(t.rotina)}")
            },
            color = l.muted,
            style = MaterialTheme.typography.bodySmall,
        ) else Text(
            t.pergunta,
            color = l.text,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier
                .align(Alignment.End)
                .then(if (fresh) Modifier.rise(8.dp, 240) else Modifier)
                .fillMaxWidth(0.85f)
                .wrapContentWidth(Alignment.End)
                .background(l.surface2, RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp))
                .padding(horizontal = 14.dp, vertical = 8.dp),
        )
        // Read aloud once it is whole, not word by word as it comes.
        Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
            Column(
                // Quiet until it is all on screen: arrived, and its last words shown.
                (if (working || at >= 0) Modifier.clearAndSetSemantics {} else Modifier),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                parts.forEach { p ->
                    key(p.id) {
                        when (p) {
                            is Mia2Texto -> {
                                val id = "${t.n}:${p.id}"
                                Mia2Rich(
                                    p,
                                    open,
                                    lead = p.id == first,
                                    stopped = t.end == "parou" && p.valores == null,
                                    pace = Pace(
                                        id,
                                        done = p.valores != null || !working,
                                        // Parar keeps what she wrote, all of it, at once; what was
                                        // shown once stays shown.
                                        on = paced && t.end != "parou" && id !in seen,
                                        moving = moving,
                                        seen = seen,
                                    ),
                                )
                                // Her values are checked once her text is whole: the note may show then,
                                // with what follows it.
                                val loose = mia2Loose(p)
                                if (loose.isNotEmpty() && id !in moving) Box(Modifier.rise(on = fresh)) { LooseNote(loose) }
                            }
                            is Mia2Desenho -> Box(Modifier.rise(on = fresh)) { MiaChart(p.grafico) }
                            is Mia2Numeros -> {
                                val id = "${t.n}:${p.id}"
                                Box(Modifier.rise(on = fresh)) { Mia2Board(p.numeros, count = paced && id !in seen) }
                                LaunchedEffect(id) { seen += id }
                            }
                        }
                    }
                }
            }
        }
        if (working) {
            Row(Modifier.rise(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // What she is doing shines while she does it; while she writes, the dots say more is
                // coming. The amber is the "confira" mark's on this screen: her wait is neutral ink.
                if (doing == null) WaitDots(l.faint)
                Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                    if (doing != null) Shine(doing, still)
                }
            }
        }
        if (t.end == "parou") {
            Column(Modifier.rise(on = fresh), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Note(if (mia2StoppedValues(t)) "Você parou esta resposta. Os valores não foram conferidos." else "Você parou esta resposta.")
                onRetry?.let { TextAction("Perguntar de novo", it, color = l.accent) }
            }
        }
        if (t.end == "descansa") {
            Text(
                "A Mia descansa até o mês que vem. Os números seguem nas telas.",
                color = l.muted,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (t.end == "falhou" || t.end == "rede") {
            Row(Modifier.rise(on = fresh), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    if (t.end == "rede") "A Mia não respondeu. Confira a internet e tente de novo." else "A Mia não conseguiu terminar esta resposta. Tente de novo.",
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
            Row(Modifier.rise(on = fresh), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
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

/**
 * What she is doing, with a light passing over it while she does it (the site's `.shine`):
 * the band is about half the line wide and crosses it in two seconds.
 */
@Composable
private fun Shine(text: String, still: Boolean) {
    val l = LocalLedger.current
    if (still) return Text(text, color = l.muted, style = MaterialTheme.typography.bodyMedium)
    val x by rememberInfiniteTransition(label = "shine").animateFloat(
        -0.5f, 1.5f, infiniteRepeatable(tween(2000, easing = LinearEasing), RepeatMode.Restart), label = "x",
    )
    var w by remember { mutableFloatStateOf(0f) }
    val band = w * 0.48f
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium.copy(
            brush = Brush.horizontalGradient(listOf(l.muted, l.text, l.muted), startX = x * w - band / 2, endX = x * w + band / 2),
        ),
        onTextLayout = { w = it.size.width.toFloat() },
    )
}

/** How one text of hers shows: at reading pace while [on], all at once otherwise. */
private data class Pace(
    val id: String,
    val done: Boolean,
    val on: Boolean,
    val moving: SnapshotStateList<String>,
    val seen: MutableSet<String>,
)

/** Her text at reading pace (the site's usePaced): how much shows, and when each word showed. */
private class Paced(on: Boolean, length: Int) {
    var pos = if (on) 0f else length.toFloat()
    var shown by mutableIntStateOf(if (on) 0 else length)
    var now by mutableLongStateOf(0L)
    var fading by mutableStateOf(on)
    val born = HashMap<String, Long>()

    /** [text] with each word that just showed fading in, by where it starts in [text]. */
    fun fade(text: AnnotatedString, prefix: String, color: Color): AnnotatedString {
        if (!fading) return text
        val b = AnnotatedString.Builder(text)
        WORD.findAll(text.text).forEach { m ->
            val since = now - born.getOrPut("$prefix:${m.range.first}") { now }
            val a = (since / Mia2Pace.FADE_MS.toFloat()).coerceIn(0f, 1f)
            // Ease out, as the site's 250 ms ease-out.
            if (a < 1f) b.addStyle(SpanStyle(color = color.copy(alpha = 1f - (1f - a) * (1f - a))), m.range.first, m.range.last + 1)
        }
        return b.toAnnotatedString()
    }
}

private val WORD = Regex("""\S+""")

@Composable
private fun rememberPaced(texto: String, pace: Pace): Paced {
    val s = remember(pace.id) { Paced(pace.on, texto.length) }
    LaunchedEffect(texto, pace.done, pace.on) {
        if (!pace.on) {
            s.shown = texto.length
            s.fading = false
            return@LaunchedEffect
        }
        var last = 0L
        while (true) {
            val t = withFrameNanos { it }
            val dt = if (last == 0L) 1f / 60 else ((t - last) / 1e9f).coerceAtMost(0.1f)
            last = t
            s.now = t / 1_000_000
            s.pos = Mia2Pace.step(s.pos, texto.length, dt)
            s.shown = Mia2Pace.cut(texto, s.pos, pace.done)
            val youngest = s.born.values.maxOrNull() ?: 0L
            if (s.pos >= texto.length && s.now - youngest >= Mia2Pace.FADE_MS) break
        }
        if (pace.done && s.shown >= texto.length) s.fading = false
    }
    val settled = !pace.on || (pace.done && s.shown >= texto.length && !s.fading)
    LaunchedEffect(settled) {
        if (!settled) {
            if (pace.id !in pace.moving) pace.moving += pace.id
            return@LaunchedEffect
        }
        if (pace.on) pace.seen += pace.id
        pace.moving.remove(pace.id)
    }
    DisposableEffect(pace.id) { onDispose { pace.moving.remove(pace.id) } }
    return s
}

/** Her text: paragraphs and lists, the main number in bold, each value as checked. */
@Composable
private fun Mia2Rich(p: Mia2Texto, open: (String, String?) -> Unit, lead: Boolean, stopped: Boolean = false, pace: Pace? = null) {
    val l = LocalLedger.current
    val s = pace?.let { rememberPaced(p.texto, it) }
    val texto = if (s == null) p.texto else p.texto.take(s.shown)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        mia2Blocks(texto).forEachIndexed { k, b ->
            if (b.list) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    b.lines.forEachIndexed { j, line ->
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("•", color = l.faint, style = MaterialTheme.typography.bodyLarge)
                            val text = inline(line, p.valores, open, stopped)
                            ValueText(s?.fade(text, "$k:$j", l.text) ?: text, MaterialTheme.typography.bodyLarge)
                        }
                    }
                }
            } else {
                // Her first paragraph is the answer, set in the book serif like every verdict in the Neko.
                val text = buildAnnotatedString {
                    b.lines.forEachIndexed { i, line ->
                        if (i > 0) append("\n")
                        append(inline(line, p.valores, open, stopped))
                    }
                }
                ValueText(
                    s?.fade(text, "$k", l.text) ?: text,
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
    // No color of its own: a value fading in with its words takes theirs (the text's, l.text).
    val link = TextLinkStyles(SpanStyle(textDecoration = TextDecoration.Underline))
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
