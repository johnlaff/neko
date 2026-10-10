package dev.johnlaff.neko.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
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

@Composable
fun MiaPanel(
    status: MiaStatus,
    ask: AskMia,
    onScreen: (String) -> Unit,
    startTalk: List<MiaExchange> = emptyList(),
) {
    val l = LocalLedger.current
    val scope = rememberCoroutineScope()
    var typed by rememberSaveable { mutableStateOf("") }
    var talk by remember { mutableStateOf(startTalk) }
    var pending by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val paused = status.pausadaAte
    val send = { q: String ->
        val pergunta = q.trim()
        if (pergunta.isNotEmpty() && !pending) {
            pending = true
            failure = null
            val recent = talk.takeLast(MAX_HISTORY)
            scope.launch {
                runCatching {
                    ask(
                        MiaAsk(
                            pergunta,
                            recent.map { MiaTurn(it.pergunta, it.reply.texto) },
                            recent.fold(emptyMap()) { acc, x -> acc + x.reply.valores },
                        ),
                    )
                }.onSuccess {
                    talk = talk + MiaExchange(pergunta, it)
                    typed = ""
                }.onFailure { e ->
                    failure = if (e is ApiException && e.status == 429) "A Mia descansa até o mês que vem."
                    else "Não consegui falar com a Mia agora. Os números seguem nas telas."
                }
                pending = false
            }
        }
    }

    Panel(Modifier.semantics { contentDescription = "Conversa com a Mia" }) {
        if (paused != null) Text("A Mia descansa até ${shortDate(paused)}.", color = l.muted)
        talk.forEach { x ->
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(x.pergunta, color = l.muted, style = MaterialTheme.typography.bodyMedium)
                MiaText(x.reply, onScreen)
            }
        }
        val line = if (pending) "A Mia está lendo a planilha…" else failure
        if (line != null) {
            Text(
                line,
                color = l.muted,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (talk.isEmpty() && paused == null) {
            // One row that slides sideways: wrapped, the five questions stacked one per line on a phone.
            Row(
                Modifier
                    // The last chip fades out at the edge, a hint that the row goes on.
                    .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
                    .drawWithContent {
                        drawContent()
                        drawRect(Brush.horizontalGradient(0.88f to Color.Black, 1f to Color.Transparent), blendMode = BlendMode.DstIn)
                    }
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                MIA_SUGGESTIONS.forEach { q -> Suggestion(q, enabled = !pending) { send(q) } }
            }
        }
        if (paused == null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = typed,
                    onValueChange = { typed = it.take(500) },
                    singleLine = true,
                    placeholder = { Text("Pergunte algo", color = l.faint) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { send(typed) }),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = l.accent, unfocusedBorderColor = l.borderInput),
                    modifier = Modifier.weight(1f).semantics { contentDescription = "Pergunta para a Mia" },
                )
                Button(
                    onClick = { send(typed) },
                    enabled = typed.isNotBlank() && !pending,
                    colors = ButtonDefaults.buttonColors(containerColor = l.text, contentColor = l.bg),
                    shape = RoundedCornerShape(10.dp),
                ) { Text("Enviar", style = MaterialTheme.typography.labelLarge) }
            }
        }
    }
}

/** Mia's text with each `{{vN}}` swapped for its value, a tap away from the screen it came from. */
@Composable
fun MiaText(reply: MiaReply, onScreen: (String) -> Unit) {
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
            else withLink(LinkAnnotation.Clickable(v.rotulo, style) { onScreen(v.tela) }) { append(miaShown(v)) }
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
