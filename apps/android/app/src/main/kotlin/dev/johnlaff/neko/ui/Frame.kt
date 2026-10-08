package dev.johnlaff.neko.ui

import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.getValue
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.platform.LocalDensity
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
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.platform.LocalHapticFeedback
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

/** The widest a screen's column gets, as on the site. */
private val MAX_WIDTH = 640.dp

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
    val haptics = LocalHapticFeedback.current
    val v = state.view
    val pull = androidx.compose.material3.pulltorefresh.rememberPullToRefreshState()
    val refreshing = state.loading && v != null
    // A pull ends with a feel of how it went: done, or it could not read the sheet.
    var pulled by remember { mutableStateOf(false) }
    LaunchedEffect(state.loading) {
        if (pulled && !state.loading) {
            pulled = false
            haptics.performHapticFeedback(if (state.error == null) HapticFeedbackType.Confirm else HapticFeedbackType.Reject)
        }
    }
    PullToRefreshBox(
        isRefreshing = refreshing,
        state = pull,
        // Below the status bar and the camera, where the content starts.
        indicator = {
            androidx.compose.material3.pulltorefresh.PullToRefreshDefaults.Indicator(
                state = pull,
                isRefreshing = refreshing,
                modifier = Modifier.align(Alignment.TopCenter).windowInsetsPadding(
                    androidx.compose.foundation.layout.WindowInsets.safeDrawing
                        .only(androidx.compose.foundation.layout.WindowInsetsSides.Top),
                ),
            )
        },
        onRefresh = {
            // The pull let go past the line: a tick says the read started.
            haptics.performHapticFeedback(HapticFeedbackType.GestureThresholdActivate)
            pulled = true
            onRefresh()
        },
        modifier = Modifier.fillMaxSize().background(l.bg),
    ) {
        LazyColumn(
            // A phone-width column on tablets and in landscape, not a stretched one.
            Modifier.fillMaxHeight().padding(start = if (LocalRail.current) RAIL_ROOM else 0.dp)
                .widthIn(max = MAX_WIDTH).fillMaxWidth().align(Alignment.TopCenter).safeDrawingPadding(),
            contentPadding = PaddingValues(start = 16.dp, top = 16.dp, end = 16.dp, bottom = if (LocalRail.current) 16.dp else DOCK_ROOM),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(title, style = MaterialTheme.typography.displayLarge, modifier = Modifier.semantics { heading() })
                        val read = when {
                            state.error == ReadError.Offline && v != null -> "Sem conexão. Esta é a última leitura"
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
                v == null -> item { Skeleton() }
                else -> content(v)
            }
        }
    }
}

/**
 * While the first read is on its way: the shape of a screen (an arc, lines, a button) with a soft
 * shimmer, the site's skeleton, instead of a sentence.
 */
@Composable
private fun Skeleton() {
    val l = LocalLedger.current
    val shimmer = rememberInfiniteTransition(label = "skeleton")
    val x by shimmer.animateFloat(-1f, 2f, infiniteRepeatable(tween(1600, easing = LinearEasing)), label = "x")
    val glow = l.text.copy(alpha = 0.06f)
    val block = Modifier.drawWithContent {
        drawRect(l.surface2)
        drawRect(
            Brush.horizontalGradient(
                listOf(Color.Transparent, glow, Color.Transparent),
                startX = size.width * (x - 0.5f),
                endX = size.width * (x + 0.5f),
            ),
        )
    }
    Panel(Modifier.semantics { contentDescription = "Lendo a planilha" }) {
        Box(Modifier.fillMaxWidth(0.4f).height(14.dp).clip(RoundedCornerShape(8.dp)).then(block))
        Canvas(Modifier.fillMaxWidth(0.7f).aspectRatio(2f).align(Alignment.CenterHorizontally)) {
            val stroke = size.width * 0.07f
            val r = (size.width - stroke) / 2
            drawArc(
                l.surface2, 180f, 180f, false, Offset(stroke / 2, stroke / 2),
                androidx.compose.ui.geometry.Size(r * 2, r * 2),
                style = Stroke(stroke, cap = StrokeCap.Round),
            )
        }
        Box(Modifier.fillMaxWidth().height(14.dp).clip(RoundedCornerShape(8.dp)).then(block))
        Box(Modifier.fillMaxWidth(0.6f).height(14.dp).clip(RoundedCornerShape(8.dp)).then(block))
        Box(Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(50)).then(block))
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
        SleepingCat(Modifier.height(84.dp))
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

/** True on a wide window (tablet, unfolded phone, desktop): the dock stands on the left as a rail. */
val LocalRail = staticCompositionLocalOf { false }

/** Width from which the dock becomes a rail, Material's "expanded" window class. */
val RAIL_FROM = 840.dp
private val RAIL_ROOM = 128.dp

/**
 * The floating pill dock, the site's: the current place in sage, the others quiet. On a wide
 * window it stands on the left, top to bottom, where the thumb and the eye don't reach across.
 */
@Composable
fun Dock(current: Tab, onSelect: (Tab) -> Unit, modifier: Modifier = Modifier) {
    val l = LocalLedger.current
    val haptics = LocalHapticFeedback.current
    val rail = LocalRail.current
    val shape = RoundedCornerShape(if (rail) 28.dp else 50.dp)
    // Tab names grow with the system text up to 130%: past that the four no longer fit one line,
    // and the screens above already carry the large text.
    val scale = LocalDensity.current.fontScale
    val label = MaterialTheme.typography.labelLarge.fontSize * (minOf(scale, 1.3f) / scale)
    val item: @Composable (Tab, Modifier) -> Unit = { tab, m ->
        val on = tab == current
        val pill by animateColorAsState(if (on) l.surface2 else Color.Transparent, tween(200), label = "pill")
        val ink by animateColorAsState(if (on) l.text else l.muted, tween(200), label = "ink")
        Text(
            tab.label,
            color = ink,
            style = MaterialTheme.typography.labelLarge.copy(
                fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
                fontSize = label,
            ),
            maxLines = 1,
            softWrap = false,
            modifier = m
                .background(pill, RoundedCornerShape(50))
                .clickable(role = Role.Tab) {
                    if (!on) haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                    onSelect(tab)
                }
                .semantics { selected = on }
                .heightIn(min = 48.dp)
                .wrapContentHeight()
                .padding(horizontal = 16.dp),
        )
    }
    val frame = Modifier
        .background(l.surface, shape)
        .border(1.dp, l.border, shape)
        .selectableGroup()
        .padding(4.dp)
    if (rail) {
        Column(
            modifier.safeDrawingPadding().padding(start = 12.dp).width(IntrinsicSize.Max).then(frame),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Tab.entries.forEach { item(it, Modifier.fillMaxWidth()) }
        }
    } else {
        Row(
            modifier.navigationBarsPadding().padding(bottom = 12.dp).then(frame),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Tab.entries.forEach { item(it, Modifier) }
        }
    }
}

/** One list line: an avatar, the name with the value on its right, and the detail below. */
@OptIn(ExperimentalLayoutApi::class)
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
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        avatar?.let {
            Box(
                Modifier.size(36.dp).background(if (accent) l.accent.copy(alpha = 0.16f) else l.surface2, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(it, color = if (accent) l.accent else l.muted, style = MaterialTheme.typography.labelMedium)
            }
            Spacer(Modifier.width(12.dp))
        }
        // The value shares only the name's line; chips and bars below get the full width, so they
        // don't clip on a small phone with large text.
        Column(Modifier.weight(1f).padding(top = if (avatar != null) 6.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                // Two lines before cutting: "Financiamento Carro 13/36" fits on a small phone.
                Text(name, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(12.dp))
                Text(value, color = valueColor, textAlign = TextAlign.End)
            }
            // Chips get their own line: beside the name they squeezed it out on narrow phones,
            // and they wrap instead of clipping when two don't fit.
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { chips() }
            meta?.let { Text(it, color = l.faint, style = MaterialTheme.typography.labelMedium) }
            below()
        }
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
    val grow = arrival(400)
    Box(modifier.fillMaxWidth().height(4.dp).background(l.surface2, RoundedCornerShape(2.dp))) {
        Box(Modifier.fillMaxWidth(share.coerceIn(0f, 1f) * grow).height(4.dp).background(color, RoundedCornerShape(2.dp)))
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
    val haptics = LocalHapticFeedback.current
    val pick = rememberUpdatedState { n: Int ->
        items.getOrNull(n)?.takeIf { !it.accent }?.let {
            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
            onSelect(it.key)
        }
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.fillMaxWidth().height(96.dp)) {
            // Each column's whole slot is its target, with no gaps, and a finger can slide across
            // them to read one after another.
            Row(
                Modifier.fillMaxSize().pointerInput(items.size) {
                    detectHorizontalDragGestures { change, _ ->
                        pick.value((change.position.x / size.width * items.size).toInt().coerceIn(0, items.size - 1))
                    }
                },
            ) {
                items.forEachIndexed { n, c ->
                    // Columns grow from the zero line one after another, like the site's.
                    val grow = arrival(360, delay = n * 15)
                    val color = when {
                        c.accent -> l.accent
                        c.faint -> l.border
                        else -> l.faint.copy(alpha = 0.55f)
                    }
                    Canvas(
                        Modifier.weight(1f).fillMaxSize()
                            .clickable { pick.value(n) }
                            .semantics { contentDescription = c.description; selected = c.accent },
                    ) {
                        val zero = size.height * (top / span)
                        val h = size.height * (kotlin.math.abs(c.value) / span) * grow
                        val y = if (c.value >= 0) zero - h else zero
                        drawRoundRect(
                            color,
                            topLeft = Offset(size.width * 0.2f, y),
                            size = androidx.compose.ui.geometry.Size(size.width * 0.6f, h.coerceAtLeast(2f)),
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
        Row(Modifier.fillMaxWidth()) {
            items.forEachIndexed { n, c ->
                Text(
                    c.label,
                    color = if (c.accent) l.text else l.faint,
                    style = MaterialTheme.typography.labelMedium,
                    textAlign = TextAlign.Center,
                    // The label belongs to its column: tapping it picks the same month.
                    modifier = Modifier.weight(1f).clearAndSetSemantics {}.clickable { pick.value(n) },
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
        // A finger-sized target around a short line of text.
        modifier = Modifier.clickable(onClick = onClick).heightIn(min = 48.dp).wrapContentHeight(),
    )
}
