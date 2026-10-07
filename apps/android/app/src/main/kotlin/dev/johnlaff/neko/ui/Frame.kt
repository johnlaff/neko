package dev.johnlaff.neko.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.ui.Format.shortDate

/** Room under the last panel so the floating dock never covers it. */
private val DOCK_ROOM = 88.dp

/**
 * What every screen shares: the title with when the sheet was read, pull to read again, and the
 * calm loading and error panels while there is nothing to show yet.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> ScreenFrame(
    title: String,
    state: ScreenState<T>,
    readAt: (T) -> String,
    onRefresh: () -> Unit,
    trailing: @Composable () -> Unit = {},
    content: LazyListScope.(T) -> Unit,
) {
    val l = LocalLedger.current
    val v = state.view
    PullToRefreshBox(
        isRefreshing = state.loading && v != null,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize().background(l.bg),
    ) {
        LazyColumn(
            Modifier.fillMaxSize().safeDrawingPadding(),
            contentPadding = PaddingValues(start = 16.dp, top = 16.dp, end = 16.dp, bottom = DOCK_ROOM),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(title, style = MaterialTheme.typography.displayLarge, modifier = Modifier.semantics { heading() })
                        val read = when {
                            state.error == ReadError.Offline && v != null -> "Sem conexão: mostrando a última leitura"
                            v != null && readAt(v).isNotEmpty() -> "Planilha lida ${readAtText(readAt(v))}"
                            else -> null
                        }
                        read?.let { Text(it, color = l.faint, style = MaterialTheme.typography.labelMedium) }
                    }
                    trailing()
                }
            }
            when {
                v == null && state.error != null -> item { ErrorPanel(state, onRefresh) }
                v == null -> item { Panel { Text("Lendo a planilha…", color = l.muted) } }
                else -> content(v)
            }
        }
    }
}

/** `2026-10-05T11:00:00Z` → `5 out, 08:00`, in São Paulo time like the site. */
fun readAtText(iso: String): String = runCatching {
    val t = java.time.Instant.parse(iso).atZone(java.time.ZoneId.of("America/Sao_Paulo"))
    "${shortDate(t.toLocalDate().toString())}, ${"%02d:%02d".format(t.hour, t.minute)}"
}.getOrDefault("")

@Composable
private fun ErrorPanel(state: ScreenState<*>, onRetry: () -> Unit) {
    val l = LocalLedger.current
    Panel {
        val structure = state.error == ReadError.SheetStructure
        Text(
            if (structure) "A planilha mudou de formato" else "Não consegui ler a planilha",
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            if (structure) "${state.detail ?: ""} O Neko só lê o formato que conhece, então nada foi calculado."
            else "Pode ser a conexão ou o Google fora do ar. A planilha não foi alterada.",
            color = l.muted,
        )
        TextButton(onClick = onRetry, enabled = !state.loading) {
            Text(if (state.loading) "Tentando…" else "Tentar de novo", color = l.accent)
        }
    }
}

/** The floating pill dock, the site's: the current place in sage, the others quiet. */
@Composable
fun Dock(current: Tab, onSelect: (Tab) -> Unit, modifier: Modifier = Modifier) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(50)
    Row(
        modifier
            .navigationBarsPadding()
            .padding(bottom = 12.dp)
            .background(l.surface, shape)
            .border(1.dp, l.border, shape)
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Tab.entries.forEach { tab ->
            val on = tab == current
            Text(
                tab.label,
                color = if (on) l.text else l.muted,
                style = MaterialTheme.typography.labelLarge.copy(fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium),
                modifier = Modifier
                    .background(if (on) l.surface2 else Color.Transparent, shape)
                    .clickable(role = Role.Tab) { onSelect(tab) }
                    .semantics { selected = on }
                    .padding(horizontal = 16.dp, vertical = 10.dp),
            )
        }
    }
}

/** One list line: an avatar, the name with its detail below, and the value on the right. */
@Composable
fun ListRow(
    name: String,
    value: String,
    modifier: Modifier = Modifier,
    avatar: String? = null,
    meta: String? = null,
    valueColor: Color = LocalLedger.current.text,
    accent: Boolean = false,
    chips: @Composable () -> Unit = {},
    below: @Composable () -> Unit = {},
) {
    val l = LocalLedger.current
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        avatar?.let {
            Box(
                Modifier.size(36.dp).background(if (accent) l.accent.copy(alpha = 0.16f) else l.surface2, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(it, color = if (accent) l.accent else l.muted, style = MaterialTheme.typography.labelMedium)
            }
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis)
            // Chips get their own line: beside the name they squeezed it out on narrow phones.
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { chips() }
            meta?.let { Text(it, color = l.faint, style = MaterialTheme.typography.labelMedium) }
            below()
        }
        Spacer(Modifier.width(12.dp))
        Text(value, color = valueColor, textAlign = TextAlign.End)
    }
}

/** Two letters for a card's avatar: "Mercado Pago" → "MP", "Amazon" → "AM". */
fun monogram(name: String): String {
    val words = name.split(Regex("\\s+")).filter { it.isNotEmpty() }
    val letters = if (words.size > 1) "${words[0][0]}${words[1][0]}" else name.take(2)
    return letters.uppercase()
}

/** A thin bar, display only: `share` comes from the API's numbers, already a fraction. */
@Composable
fun Meter(share: Float, modifier: Modifier = Modifier, color: Color = LocalLedger.current.muted) {
    val l = LocalLedger.current
    Box(modifier.fillMaxWidth().height(4.dp).background(l.surface2, RoundedCornerShape(2.dp))) {
        Box(Modifier.fillMaxWidth(share.coerceIn(0f, 1f)).height(4.dp).background(color, RoundedCornerShape(2.dp)))
    }
}

data class Bar(
    val key: String,
    val label: String,
    val value: Long,
    val description: String,
    val accent: Boolean = false,
    val faint: Boolean = false,
)

/**
 * Columns from a zero line, scaled to the largest absolute value, like the site's Columns. Display
 * only: the values come from the API, this turns them into heights. Tap a column to pick it.
 */
@Composable
fun Columns(items: List<Bar>, onSelect: (String) -> Unit, guide: Long? = null, modifier: Modifier = Modifier) {
    val l = LocalLedger.current
    val top = maxOf(0L, items.maxOfOrNull { it.value } ?: 0L, guide ?: 0L)
    val bottom = minOf(0L, items.minOfOrNull { it.value } ?: 0L)
    val span = (top - bottom).coerceAtLeast(1L).toFloat()
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.fillMaxWidth().height(96.dp)) {
            Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                items.forEach { c ->
                    val color = when {
                        c.accent -> l.accent
                        c.faint -> l.border
                        else -> l.faint.copy(alpha = 0.55f)
                    }
                    Canvas(
                        Modifier.weight(1f).fillMaxSize()
                            .clickable { onSelect(c.key) }
                            .semantics { contentDescription = c.description; selected = c.accent },
                    ) {
                        val zero = size.height * (top / span)
                        val h = size.height * (kotlin.math.abs(c.value) / span)
                        val y = if (c.value >= 0) zero - h else zero
                        drawRoundRect(
                            color,
                            topLeft = Offset(size.width * 0.15f, y),
                            size = androidx.compose.ui.geometry.Size(size.width * 0.7f, h.coerceAtLeast(2f)),
                            cornerRadius = androidx.compose.ui.geometry.CornerRadius(6f, 6f),
                        )
                    }
                }
            }
            guide?.let { g ->
                Canvas(Modifier.fillMaxSize()) {
                    val y = size.height * ((top - g) / span)
                    drawLine(
                        l.muted,
                        Offset(0f, y),
                        Offset(size.width, y),
                        strokeWidth = 2f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 8f)),
                    )
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items.forEach { c ->
                Text(
                    c.label,
                    color = if (c.accent) l.text else l.faint,
                    style = MaterialTheme.typography.labelMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

/** A small text action, like the site's text links. */
@Composable
fun TextAction(text: String, onClick: () -> Unit, color: Color = LocalLedger.current.muted) {
    Text(
        text,
        color = color,
        style = MaterialTheme.typography.labelLarge,
        modifier = Modifier.clickable(onClick = onClick).padding(vertical = 4.dp),
    )
}
