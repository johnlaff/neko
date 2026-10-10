package dev.johnlaff.neko.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import dev.johnlaff.neko.R
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.ApiException
import dev.johnlaff.neko.data.MiaAsk
import dev.johnlaff.neko.data.MiaReply
import dev.johnlaff.neko.data.MiaStatus
import dev.johnlaff.neko.data.MiaTurn
import dev.johnlaff.neko.data.MiaValue
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.shortDate
import kotlin.math.abs
import android.provider.Settings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Sends a question to the Worker; throws when it cannot answer. */
typealias AskMia = suspend (MiaAsk) -> MiaReply

/** Questions Mia answers well, one tap each, led by the screen she came from (the site's MIA_TOPICS). */
private val MIA_TOPICS = mapOf(
    "hoje" to listOf("Quanto cabe por dia?", "Como está minha reserva?"),
    "faturas" to listOf("Quanto vem na próxima fatura?", "Qual cartão está mais alto?"),
    "mes" to listOf("Quanto saiu no mês passado?", "Este mês está melhor que o anterior?", "Quanto gastei com mercado este ano?"),
)

/** Five questions, those about the screen Mia was opened from ("hoje", "faturas", "mes") first. */
fun miaStarters(topic: String = "hoje"): List<String> =
    (MIA_TOPICS[topic].orEmpty() + MIA_TOPICS.values.flatten()).distinct().take(5)

/** The empty screen's title, naming the screen she was opened from. */
fun miaTitle(topic: String = "hoje"): String = when (topic) {
    "faturas" -> "Pergunte sobre as faturas"
    "mes" -> "Pergunte sobre os meses"
    else -> "Pergunte sobre a sua planilha"
}

/** Exchanges sent back with a question; the Worker takes no more. */
private const val MAX_HISTORY = 6

private val REF = Regex("""\{\{(\w+)\}\}""")

/**
 * A value as the screen shows it. Differences and percents show their size only: the words around
 * them ("subiu", "caiu") carry the direction the engine computed.
 */
fun miaShown(v: MiaValue): String = when {
    v.pct != null -> "${abs(v.pct)}%"
    v.tipo == "diferenca" -> money(abs(v.cents ?: 0))
    else -> money(v.cents ?: 0)
}

data class MiaExchange(val pergunta: String, val reply: MiaReply)

/** A screen an answer's numbers came from, as the site's miaSources. */
data class MiaSource(val tela: String, val mes: String?, val label: String)

/**
 * The screens an answer's numbers came from, as plain ways out: "Ver setembro", "Ver faturas".
 * Hoje is left out, the screen she is opened from. Two at most, so the answer stays the main thing.
 */
fun miaSources(reply: MiaReply): List<MiaSource> {
    val values = reply.valores.values
    // A month-less Mês value (a difference) adds nothing when the answer names its month.
    val named = values.any { it.tela == "mes" && it.mes != null }
    return values
        .filterNot { it.tela == "hoje" || (it.tela == "mes" && it.mes == null && named) }
        .distinctBy { it.tela to it.mes }
        .map { v ->
            val label = when {
                v.tela == "faturas" -> "Ver faturas"
                v.mes != null -> "Ver ${Format.monthName(v.mes.drop(5).take(2).toInt())}"
                else -> "Ver o mês"
            }
            MiaSource(v.tela, v.mes, label)
        }
        .take(2)
        // Two Septembers of different years say which is which.
        .let { out ->
            out.map { src ->
                if (src.mes != null && out.count { it.label == src.label } > 1) src.copy(label = "${src.label} de ${src.mes.take(4)}") else src
            }
        }
}

/** After an answer, two questions not asked yet, so the next one is a tap away. */
fun miaNext(asked: List<String>, topic: String = "hoje"): List<String> =
    (miaStarters(topic) + MIA_TOPICS.values.flatten()).distinct().filterNot { it in asked }.take(2)

/** What the wait line says as it goes on: the answer can take a while, and silence reads as stuck. */
fun miaWaiting(seconds: Int): String = when {
    seconds < 6 -> "A Mia está lendo a planilha…"
    seconds < 20 -> "Fazendo as contas…"
    else -> "Ainda calculando. Às vezes leva um minuto."
}

/**
 * The site's "Perguntar à Mia" (web/Mia.tsx): a quiet row under Lançar and Simular, not a third
 * big button, leading to Mia's own screen. It says so when a conversation is waiting there.
 */
@Composable
fun MiaButton(continuing: Boolean, onClick: () -> Unit) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier.fillMaxWidth()
            .background(l.surface, shape)
            .border(1.dp, l.border, shape)
            .clip(shape)
            .clickable(onClickLabel = "Abrir a Mia", role = Role.Button, onClick = onClick)
            .semantics(mergeDescendants = true) {}
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        MiaMark(40.dp)
        Column(Modifier.weight(1f)) {
            Text("Perguntar à Mia", style = MaterialTheme.typography.titleMedium)
            Text(
                if (continuing) "Continuar a conversa" else "Respostas com os números da sua planilha",
                color = l.muted,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        androidx.compose.material3.Icon(
            androidx.compose.ui.res.painterResource(dev.johnlaff.neko.R.drawable.ic_chevron_right),
            null,
            tint = l.faint,
            modifier = Modifier.size(16.dp),
        )
    }
}

/**
 * Mia in the head of Hoje, Faturas and Mês (the site's MiaHead): her screen from any tab, her first
 * questions about the one it was opened from.
 */
@Composable
fun MiaHead(onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.semantics { contentDescription = "Perguntar à Mia" }) {
        MiaMark(24.dp)
    }
}

/**
 * The conversation, kept by the app rather than by Mia's screen: leaving her to check a month and
 * coming back finds it where it was, an answer still on its way included, as on the site.
 */
class MiaChat(start: List<MiaExchange> = emptyList()) {
    var talk by mutableStateOf(start)
    var typed by mutableStateOf("")
    /** The question waiting for its answer. */
    var pending by mutableStateOf<String?>(null)
    /** When the question on its way was sent, so the wait line counts from there. */
    var sentAt by mutableStateOf(0L)
    /** The question that just failed, waiting in "Tentar de novo"; the month's limit is `limited`. */
    var failed by mutableStateOf<String?>(null)
    /** The month's limit was reached: she rests until the app opens again, whatever is cleared. */
    var limited by mutableStateOf(false)
    /** Whether the question field has the focus, so an answer only closes the keyboard it opened. */
    var typing by mutableStateOf(false)

    fun clear() {
        talk = emptyList()
        failed = null
    }
}

/**
 * Mia's own screen (the site's /mia): the whole window for the conversation, no dock, the question
 * field pinned above the keyboard. Back returns to Hoje; the conversation stays in `chat`.
 */
@Composable
fun MiaScreen(
    /** Null while it is still being read: the bar shows, nothing else yet. */
    status: MiaStatus?,
    ask: AskMia,
    chat: MiaChat,
    scope: CoroutineScope,
    onBack: () -> Unit,
    onScreen: (String) -> Unit,
    onMonth: (String?) -> Unit = { onScreen("mes") },
    /** The screen she was opened from: her first questions are about it. */
    topic: String = "hoje",
) {
    val l = LocalLedger.current
    val focus = LocalFocusManager.current
    val input = remember { FocusRequester() }
    val list = rememberLazyListState()
    var seconds by remember { mutableStateOf(0) }
    // Gone from the window, the field no longer holds the focus an answer might close.
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
    val send = { q: String ->
        val pergunta = q.trim()
        if (pergunta.isNotEmpty() && chat.pending == null) {
            chat.pending = pergunta
            chat.sentAt = System.currentTimeMillis()
            chat.failed = null
            chat.typed = ""
            val recent = chat.talk.takeLast(MAX_HISTORY)
            scope.launch {
                try {
                    val reply = ask(
                        MiaAsk(
                            pergunta,
                            recent.map { MiaTurn(it.pergunta, it.reply.texto) },
                            recent.fold(emptyMap()) { acc, x -> acc + x.reply.valores },
                        ),
                    )
                    chat.talk = chat.talk + MiaExchange(pergunta, reply)
                    // The keyboard closes, so the answer shows; never a field the owner moved to.
                    if (chat.typing) focus.clearFocus()
                } catch (c: CancellationException) {
                    throw c
                } catch (e: Throwable) {
                    if (e is ApiException && e.status == 429) chat.limited = true else chat.failed = pergunta
                } finally {
                    chat.pending = null
                }
            }
        }
    }
    val talk = chat.talk
    // The newest answer is read from its top; a question just sent shows with the wait under it.
    LaunchedEffect(talk.size) { if (talk.isNotEmpty()) list.animateScrollToItem(lead + talk.size - 1) }
    LaunchedEffect(chat.pending) { if (chat.pending != null) list.animateScrollToItem(lead + talk.size + 1) }
    val line = when {
        chat.pending != null -> miaWaiting(seconds)
        // Reached while asking: said where the wait was, so TalkBack reads it.
        chat.limited -> "A Mia descansa até o mês que vem. Os números seguem nas telas."
        chat.failed != null -> "Não consegui falar com a Mia agora."
        else -> null
    }
    // A question that just failed waits in "Tentar de novo", not again among the chips.
    val asked = talk.map { it.pergunta } + listOfNotNull(chat.failed)
    val next = if (talk.isEmpty() || resting || chat.typed.isNotBlank() || chat.pending != null) emptyList() else miaNext(asked, topic)

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
                if (talk.isNotEmpty()) {
                    TextAction("Nova conversa", enabled = chat.pending == null, color = if (chat.pending == null) l.accent else l.faint, onClick = {
                        chat.clear()
                        // The action goes away with the conversation; the focus lands where the next one starts.
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
                // Paused on opening: said first.
                if (on && lead == 1 && paused != null) item(key = "lead") {
                    Text("A Mia descansa até ${shortDate(paused)}. Os números seguem nas telas.", color = l.muted)
                }
                if (on && talk.isEmpty() && chat.pending == null) item(key = "empty") {
                    MiaEmpty(miaTitle(topic), if (resting) emptyList() else miaStarters(topic).filterNot { it in asked }) { send(it) }
                }
                // A question on its way and its answer share one key, so TalkBack reads the answer
                // where it lands.
                itemsIndexed(talk, key = { i, _ -> "x$i" }) { i, x ->
                    val newest = i == talk.lastIndex && chat.pending == null
                    MiaTurnItem(x.pergunta, x.reply, if (newest) miaSources(x.reply) else emptyList(), open, live = i == talk.lastIndex)
                }
                chat.pending?.let { q -> item(key = "x${talk.size}") { MiaTurnItem(q, null, emptyList(), open, live = true) } }
                item(key = "wait") {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (chat.pending != null) WaitDots()
                        Box(Modifier.weight(1f, fill = false).semantics { liveRegion = LiveRegionMode.Polite }) {
                            if (line != null) Text(line, color = l.muted, style = MaterialTheme.typography.bodyMedium)
                        }
                        val retry = chat.failed
                        if (retry != null && chat.pending == null && !chat.limited) {
                            TextAction("Tentar de novo", { send(retry) }, color = l.accent)
                        }
                    }
                }
            }
            if (on && !resting) {
                HorizontalDivider(color = l.border)
                Column(
                    Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    // While typing, the keyboard takes the room: the suggested questions step aside.
                    if (next.isNotEmpty() && !chat.typing) {
                        Row(
                            Modifier
                                // The last chip fades out at the edge, a hint that the row goes on.
                                .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                                .drawWithContent {
                                    drawContent()
                                    drawRect(Brush.horizontalGradient(0.88f to Color.Black, 1f to Color.Transparent), blendMode = BlendMode.DstIn)
                                }
                                // A new row starts at its first question, not where the last one was slid to.
                                .horizontalScroll(key(talk.size) { rememberScrollState() }),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            next.forEach { q -> Suggestion(q) { send(q) } }
                        }
                    }
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedTextField(
                            value = chat.typed,
                            onValueChange = { chat.typed = it.take(500) },
                            singleLine = true,
                            placeholder = { Text(if (talk.isEmpty()) "Pergunte algo" else "Outra pergunta?", color = l.faint) },
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                            keyboardActions = KeyboardActions(onSend = { send(chat.typed) }),
                            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = l.accent, unfocusedBorderColor = l.borderInput),
                            modifier = Modifier
                                .weight(1f)
                                .focusRequester(input)
                                .onFocusChanged { chat.typing = it.isFocused }
                                .semantics { contentDescription = "Pergunta para a Mia" },
                        )
                        Button(
                            onClick = { send(chat.typed) },
                            enabled = chat.typed.isNotBlank() && chat.pending == null,
                            colors = ButtonDefaults.buttonColors(containerColor = l.text, contentColor = l.bg),
                            shape = RoundedCornerShape(10.dp),
                        ) { Text("Enviar", style = MaterialTheme.typography.labelLarge) }
                    }
                }
            }
        }
    }
}

/** Before the first question: what she does, and the questions she answers well, one per line. */
@Composable
private fun MiaEmpty(title: String, starters: List<String>, onAsk: (String) -> Unit) {
    val l = LocalLedger.current
    Column(Modifier.padding(top = 56.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        Text(
            "A Mia responde com os números das telas do Neko, e cada um leva à tela de onde veio.",
            color = l.muted,
            modifier = Modifier.padding(bottom = 12.dp),
        )
        starters.forEach { q -> Suggestion(q, wrap = true) { onAsk(q) } }
    }
}

/** One question, as a quiet bubble to the right, and Mia's answer under it in plain text. */
@Composable
private fun MiaTurnItem(
    pergunta: String,
    reply: MiaReply?,
    sources: List<MiaSource>,
    open: (String, String?) -> Unit,
    /** Only the newest turn is read aloud as it lands; older ones scrolled back into view are not. */
    live: Boolean,
) {
    val l = LocalLedger.current
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            pergunta,
            color = l.text,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier
                .align(Alignment.End)
                .fillMaxWidth(0.85f)
                .wrapContentWidth(Alignment.End)
                .background(l.surface2, RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp))
                .padding(horizontal = 14.dp, vertical = 8.dp),
        )
        Box(if (live) Modifier.semantics { liveRegion = LiveRegionMode.Polite } else Modifier) {
            if (reply != null) MiaText(reply, open)
        }
        // Only the newest answer offers its screens, so older ones stay plain text.
        if (sources.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                sources.forEach { src -> TextAction(src.label, { open(src.tela, src.mes) }, color = l.accent) }
            }
        }
    }
}

/** Three soft dots that breathe while Mia works, as on the site. */
@Composable
private fun WaitDots() {
    val l = LocalLedger.current
    // Still when the phone asks for no animations.
    val resolver = LocalContext.current.contentResolver
    val still = remember { Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
    val pulse by rememberInfiniteTransition(label = "wait").animateFloat(
        1f, 0.35f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "dots",
    )
    Row(Modifier.graphicsLayer { alpha = if (still) 1f else pulse }, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        repeat(3) { Box(Modifier.size(5.dp).background(l.mia, CircleShape)) }
    }
}

/** Mia's text with each `{{vN}}` swapped for its value, a tap away from the screen it came from. */
@Composable
fun MiaText(reply: MiaReply, onOpen: (String, String?) -> Unit) {
    val l = LocalLedger.current
    val style = TextLinkStyles(
        SpanStyle(color = l.text, fontWeight = FontWeight.SemiBold, textDecoration = TextDecoration.Underline),
    )
    val text = buildAnnotatedString {
        var at = 0
        REF.findAll(reply.texto).forEach { m ->
            append(reply.texto.substring(at, m.range.first))
            val v = reply.valores[m.groupValues[1]]
            if (v == null) append("…")
            else withLink(LinkAnnotation.Clickable(v.rotulo, style) { onOpen(v.tela, v.mes) }) { append(miaShown(v)) }
            at = m.range.last + 1
        }
        append(reply.texto.substring(at))
    }
    Text(text, color = l.text, style = MaterialTheme.typography.bodyLarge)
}

@Composable
private fun Suggestion(text: String, wrap: Boolean = false, onClick: () -> Unit) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(50)
    Text(
        text,
        color = l.text,
        style = MaterialTheme.typography.labelLarge,
        maxLines = if (wrap) Int.MAX_VALUE else 1,
        softWrap = wrap,
        modifier = Modifier
            .minimumInteractiveComponentSize()
            .background(l.surface2, shape)
            .border(1.dp, l.border, shape)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    )
}
