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
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.compose.ui.semantics.stateDescription
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

/** Questions Mia answers well, one tap each (the site's MIA_SUGGESTIONS). */
val MIA_SUGGESTIONS = listOf(
    "Quanto cabe por dia?",
    "Quanto saiu no mês passado?",
    "Este mês está melhor que o anterior?",
    "Quanto gastei com mercado este ano?",
    "Como está minha reserva?",
)

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
 * Hoje is left out, since Mia lives there. Two at most, so the answer stays the main thing.
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
fun miaNext(asked: List<String>): List<String> = MIA_SUGGESTIONS.filterNot { it in asked }.take(2)

/** What the wait line says as it goes on: the answer can take a while, and silence reads as stuck. */
fun miaWaiting(seconds: Int): String = when {
    seconds < 6 -> "A Mia está lendo a planilha…"
    seconds < 20 -> "Fazendo as contas…"
    else -> "Ainda calculando. Às vezes leva um minuto."
}

/**
 * The site's "Perguntar à Mia" (web/Mia.tsx): a quiet row under Lançar and Simular, not a third
 * big button. The chevron turns when the conversation is open.
 */
@Composable
fun MiaButton(open: Boolean, onClick: () -> Unit) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(12.dp)
    val turn by androidx.compose.animation.core.animateFloatAsState(if (open) 90f else 0f, label = "chevron")
    Row(
        Modifier.fillMaxWidth()
            .background(l.surface, shape)
            .border(1.dp, l.border, shape)
            .clip(shape)
            .clickable(onClickLabel = if (open) "Fechar a conversa" else "Abrir a conversa", onClick = onClick)
            .semantics(mergeDescendants = true) { stateDescription = if (open) "Aberto" else "Fechado" }
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        MiaMark(40.dp)
        Column(Modifier.weight(1f)) {
            Text("Perguntar à Mia", style = MaterialTheme.typography.titleMedium)
            Text("Respostas com os números da sua planilha", color = l.muted, style = MaterialTheme.typography.bodyMedium)
        }
        androidx.compose.material3.Icon(
            androidx.compose.ui.res.painterResource(dev.johnlaff.neko.R.drawable.ic_chevron_right),
            null,
            tint = l.faint,
            modifier = Modifier.size(16.dp).graphicsLayer { rotationZ = turn },
        )
    }
}

/**
 * The conversation, kept by Hoje rather than by the panel: closing the panel or scrolling it out of
 * the list keeps what was said and lets an answer on its way arrive, as on the site.
 */
class MiaChat(start: List<MiaExchange> = emptyList()) {
    var talk by mutableStateOf(start)
    var typed by mutableStateOf("")
    var pending by mutableStateOf(false)
    /** When the question on its way was sent, so the wait line counts from there. */
    var sentAt by mutableStateOf(0L)
    /** Set when Mia could not answer; the month's limit is `limited` instead. */
    var failed by mutableStateOf(false)
    var lastAsked by mutableStateOf<String?>(null)
    /** The month's limit was reached: she rests until Hoje opens again, whatever is cleared. */
    var limited by mutableStateOf(false)
    /** Whether the question field has the focus, so an answer only closes the keyboard it opened. */
    var typing by mutableStateOf(false)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MiaPanel(
    status: MiaStatus,
    ask: AskMia,
    onScreen: (String) -> Unit,
    chat: MiaChat = remember { MiaChat() },
    scope: CoroutineScope = rememberCoroutineScope(),
    onMonth: (String?) -> Unit = { onScreen("mes") },
) {
    val l = LocalLedger.current
    val focus = LocalFocusManager.current
    val input = remember { FocusRequester() }
    var seconds by remember { mutableStateOf(0) }
    // Gone from the list, the field no longer holds the focus an answer might close.
    DisposableEffect(Unit) { onDispose { chat.typing = false } }
    LaunchedEffect(chat.pending) {
        while (chat.pending) {
            seconds = ((System.currentTimeMillis() - chat.sentAt) / 1000).toInt()
            delay(1000)
        }
        seconds = 0
    }
    val paused = status.pausadaAte
    val resting = paused != null || chat.limited
    val open = { tela: String, mes: String? -> if (tela == "mes") onMonth(mes) else onScreen(tela) }
    val send = { q: String ->
        val pergunta = q.trim()
        if (pergunta.isNotEmpty() && !chat.pending) {
            chat.pending = true
            chat.sentAt = System.currentTimeMillis()
            chat.failed = false
            chat.lastAsked = pergunta
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
                    chat.typed = ""
                    // The keyboard closes, so the answer shows; never a field the owner moved to.
                    if (chat.typing) focus.clearFocus()
                } catch (c: CancellationException) {
                    throw c
                } catch (e: Throwable) {
                    if (e is ApiException && e.status == 429) chat.limited = true else chat.failed = true
                } finally {
                    chat.pending = false
                }
            }
        }
    }
    val talk = chat.talk
    val newest = talk.lastOrNull()
    val line = when {
        chat.pending -> miaWaiting(seconds)
        // Reached while asking: said where the wait was, so TalkBack reads it.
        chat.limited -> "A Mia descansa até o mês que vem. Os números seguem nas telas."
        chat.failed -> "Não consegui falar com a Mia agora."
        else -> null
    }
    // A question that just failed waits in "Tentar de novo", not again among the chips.
    val asked = talk.map { it.pergunta } + listOfNotNull(chat.lastAsked.takeIf { chat.failed })
    val chips = when {
        resting || chat.typed.isNotBlank() || chat.pending -> emptyList()
        talk.isEmpty() -> MIA_SUGGESTIONS.filterNot { it in asked }
        else -> miaNext(asked)
    }

    Panel(Modifier.semantics { contentDescription = "Conversa com a Mia" }) {
        // Paused on opening: said first.
        if (paused != null && !chat.limited) {
            Text("A Mia descansa até ${shortDate(paused)}. Os números seguem nas telas.", color = l.muted)
        }
        talk.dropLast(1).forEach { x ->
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(x.pergunta, color = l.muted, style = MaterialTheme.typography.bodyMedium)
                MiaText(x.reply, open)
            }
        }
        // The newest answer and the wait line always sit in the same places, so TalkBack reads what
        // changes in them. They share one slot with no gap of their own while empty.
        val gap = 12.dp
        if (newest != null || line != null || chips.isNotEmpty() || !resting) Column {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (newest != null) Text(newest.pergunta, color = l.muted, style = MaterialTheme.typography.bodyMedium)
                Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                    if (newest != null) MiaText(newest.reply, open)
                }
                // Only the newest answer offers its screens, so older ones stay plain text.
                val sources: List<MiaSource> = if (newest != null) miaSources(newest.reply) else emptyList()
                if (sources.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        sources.forEach { src -> TextAction(src.label, { open(src.tela, src.mes) }, color = l.accent) }
                    }
                }
            }
            Row(
                Modifier.padding(top = if (line != null && newest != null) gap else 0.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (chat.pending) WaitDots()
                Box(Modifier.weight(1f, fill = false).semantics { liveRegion = LiveRegionMode.Polite }) {
                    if (line != null) Text(line, color = l.muted, style = MaterialTheme.typography.bodyMedium)
                }
                val retry = chat.lastAsked
                if (chat.failed && retry != null) TextAction("Tentar de novo", { send(retry) }, color = l.accent)
            }
            val above = newest != null || line != null
            if (chips.isNotEmpty()) {
                // One row that slides sideways: wrapped, the five questions stacked one per line on a phone.
                Row(
                    Modifier
                        .padding(top = if (above) gap else 0.dp)
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
                    chips.forEach { q -> Suggestion(q, enabled = !chat.pending) { send(q) } }
                }
            }
            if (!resting) {
                Row(
                    Modifier.padding(top = if (above || chips.isNotEmpty()) gap else 0.dp),
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
                        enabled = chat.typed.isNotBlank() && !chat.pending,
                        colors = ButtonDefaults.buttonColors(containerColor = l.text, contentColor = l.bg),
                        shape = RoundedCornerShape(10.dp),
                    ) { Text("Enviar", style = MaterialTheme.typography.labelLarge) }
                }
            }
        }
        if (talk.isNotEmpty() && !chat.pending) {
            TextAction("Nova conversa", {
                chat.talk = emptyList()
                chat.failed = false
                chat.lastAsked = null
                // The action goes away with the conversation; the focus lands where the next one starts.
                if (!resting) runCatching { input.requestFocus() }
            })
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
private fun Suggestion(text: String, enabled: Boolean, onClick: () -> Unit) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(50)
    Text(
        text,
        color = l.text,
        style = MaterialTheme.typography.labelLarge,
        maxLines = 1,
        softWrap = false,
        modifier = Modifier
            .minimumInteractiveComponentSize()
            .background(l.surface2, shape)
            .border(1.dp, l.border, shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}
