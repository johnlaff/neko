package dev.johnlaff.neko.ui

import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.runtime.withFrameNanos
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.focus.FocusRequester
import dev.johnlaff.neko.R
import dev.johnlaff.neko.ui.Format.shortDate

/** Room under the last panel so the floating dock never covers it. */
internal val DOCK_ROOM = 88.dp

/** The widest a screen's column gets, as on the site. */
private val MAX_WIDTH = 640.dp

/** The widest the two columns get on a wide window, the site's 72rem. */
private val WIDE_MAX_WIDTH = 1152.dp

/**
 * A screen's panels in the phone's order. On a wide window (the rail's) they stand in two columns,
 * as on the site: [column] starts the second one, and [full] panels go across above both.
 */
class Panels {
    internal val above = mutableListOf<@Composable () -> Unit>()
    internal val columns = mutableListOf(mutableListOf<@Composable () -> Unit>())

    fun item(content: @Composable () -> Unit) {
        columns.last() += content
    }

    /** Across the whole width, above the columns: the month's arrows on Mês. */
    fun full(content: @Composable () -> Unit) {
        above += content
    }

    /** The panels after this one go to the next column on a wide window. */
    fun column() {
        if (columns.last().isNotEmpty()) columns += mutableListOf<@Composable () -> Unit>()
    }
}

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
    /** The screen Mia's mark in the head asks her about; null leaves the mark out. */
    miaTopic: String? = null,
    content: Panels.(T) -> Unit,
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
        val rail = LocalRail.current
        val panels = v?.let { Panels().apply { content(it) } }
        val head = @Composable {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(title, style = MaterialTheme.typography.displayLarge, modifier = Modifier.semantics { heading() })
                        val at = v?.let(readAt).orEmpty()
                        val offline = state.error == ReadError.Offline && v != null
                        val read = when {
                            refreshing && at.isNotEmpty() -> "Lendo a planilha…"
                            offline && at.isNotEmpty() -> "Sem conexão · Lida ${readAtText(at)}"
                            offline -> "Sem conexão. Esta é a última leitura"
                            at.isNotEmpty() -> "Planilha lida ${readAtText(at)}"
                            else -> null
                        }
                        // Offline is the one state the head must not let you miss: a solid dot before the words.
                        read?.let {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (offline) Box(Modifier.size(8.dp).background(l.warn, CircleShape))
                                Text(
                                    it,
                                    color = if (offline) l.warn else l.faint,
                                    style = MaterialTheme.typography.labelMedium.let { s ->
                                        if (offline) s.copy(fontWeight = FontWeight.SemiBold) else s
                                    },
                                )
                            }
                        }
                    }
                    // Mia beside the title on the tabs she can talk about, as in the site's head.
                    if (miaTopic != null) MiaHead(miaTopic)
                    trailing()
                }
        }
        if (rail && panels != null) {
            // A wide window: the head and the full-width panels, then the columns side by side, each
            // stacking its own panels so a short one leaves no hole beside a tall one.
            Column(
                Modifier.fillMaxHeight().padding(start = RAIL_ROOM).widthIn(max = WIDE_MAX_WIDTH).fillMaxWidth()
                    .align(Alignment.TopCenter).safeDrawingPadding().verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                head()
                panels.above.forEach { it() }
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
                    panels.columns.forEach { col ->
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) { col.forEach { it() } }
                    }
                }
            }
            return@PullToRefreshBox
        }
        LazyColumn(
            // A phone-width column on tablets in portrait, not a stretched one.
            Modifier.fillMaxHeight().padding(start = if (rail) RAIL_ROOM else 0.dp)
                .widthIn(max = MAX_WIDTH).fillMaxWidth().align(Alignment.TopCenter).safeDrawingPadding(),
            contentPadding = PaddingValues(start = 16.dp, top = 16.dp, end = 16.dp, bottom = if (rail) 16.dp else DOCK_ROOM),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { head() }
            when {
                v == null && state.error != null -> item { ErrorPanel(state, onRefresh) }
                v == null -> item { Skeleton() }
                else -> panels?.let { p -> (p.above + p.columns.flatten()).forEach { item { it() } } }
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
        Box(Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(10.dp)).then(block))
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
        QuietMark(64.dp)
        Text(
            if (structure) "A planilha mudou de formato" else "Não consegui ler a planilha",
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            if (structure) "${state.detail ?: ""} Fora do formato esperado, nada foi calculado."
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

/**
 * The ways into Mia from the tabs (the head mark), null while she is off: opens her
 * about a screen ("hoje", "faturas", "mes") and, when she closes, hands the focus back to the way in.
 */
class MiaEntry(private val onOpen: (topic: String, by: String) -> Unit, val talking: () -> Boolean) {
    /** "head" right after she closes, until that way in has the focus again. */
    var returning by mutableStateOf<String?>(null)

    fun open(topic: String, by: String) {
        returning = null
        onOpen(topic, by)
    }
}

val LocalMia = staticCompositionLocalOf<MiaEntry?> { null }

/** The focus of a way into Mia, taken back when she closes onto it, as on the site. */
@Composable
fun rememberMiaReturn(by: String): FocusRequester {
    val entry = LocalMia.current
    val focus = remember { FocusRequester() }
    LaunchedEffect(entry?.returning) {
        if (entry == null || entry.returning != by) return@LaunchedEffect
        // Mia's screen may still be sliding out, or the way in not laid out yet: a few frames, then let go.
        repeat(30) {
            withFrameNanos { }
            if (runCatching { focus.requestFocus() }.isSuccess) {
                entry.returning = null
                return@LaunchedEffect
            }
        }
        entry.returning = null
    }
    return focus
}

/** The site's tab icons (icons.tsx), drawn the same on the dock and the rail. */
private val Tab.icon: Int
    get() = when (this) {
        Tab.Hoje -> R.drawable.tab_hoje
        Tab.Faturas -> R.drawable.tab_faturas
        Tab.Mes -> R.drawable.tab_mes
        Tab.Ajustes -> R.drawable.tab_ajustes
    }

/** Width from which the dock becomes a rail, Material's "expanded" window class. */
val RAIL_FROM = 840.dp
private val RAIL_ROOM = 128.dp

/**
 * The floating pill dock, the site's: each tab an icon over its name, the current place in sage,
 * the others quiet. On a wide
 * window it stands on the left, level with the screen's title, as on the site.
 */
@Composable
fun Dock(current: Tab, onSelect: (Tab) -> Unit, modifier: Modifier = Modifier) {
    val l = LocalLedger.current
    val haptics = LocalHapticFeedback.current
    val rail = LocalRail.current
    val shape = RoundedCornerShape(16.dp)
    // Tab names grow with the system text up to 130%: past that the four no longer fit one line,
    // and the screens above already carry the large text.
    val scale = LocalDensity.current.fontScale
    val label = MaterialTheme.typography.labelMedium.fontSize * (minOf(scale, 1.3f) / scale)
    val item: @Composable (Tab, Modifier) -> Unit = { tab, m ->
        val on = tab == current
        val pill by animateColorAsState(if (on) l.surface2 else Color.Transparent, tween(200), label = "pill")
        val ink by animateColorAsState(if (on) l.text else l.muted, tween(200), label = "ink")
        Column(
            m
                .background(pill, RoundedCornerShape(12.dp))
                .clickable(role = Role.Tab) {
                    if (!on) haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                    onSelect(tab)
                }
                .semantics(mergeDescendants = true) { selected = on }
                .heightIn(min = 56.dp)
                .padding(horizontal = 14.dp, vertical = 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            androidx.compose.material3.Icon(
                androidx.compose.ui.res.painterResource(tab.icon),
                contentDescription = null,
                tint = ink,
                modifier = Modifier.size(20.dp),
            )
            Text(
                tab.label,
                color = ink,
                style = MaterialTheme.typography.labelMedium.copy(
                    fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
                    fontSize = label,
                ),
                maxLines = 1,
                softWrap = false,
            )
        }
    }
    val frame = Modifier
        .background(l.surface, shape)
        .border(1.dp, l.border, shape)
        .selectableGroup()
        .padding(4.dp)
    if (rail) {
        Column(
            modifier.safeDrawingPadding().padding(start = 12.dp, top = 16.dp).width(IntrinsicSize.Max).then(frame),
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
    /** An icon in the avatar instead of its letters. */
    avatarIcon: Int? = null,
    /** A line's category icon (Categories.kt); wins over avatarIcon. */
    avatarVector: androidx.compose.ui.graphics.vector.ImageVector? = null,
    /** A card's name: when it names a known bank, the avatar is that bank's mark. */
    card: String? = null,
    meta: String? = null,
    valueColor: Color = LocalLedger.current.text,
    accent: Boolean = false,
    chips: @Composable () -> Unit = {},
    below: @Composable () -> Unit = {},
    /** A line that opens: a chevron after the value, turning as it opens (as on the site). */
    open: Boolean? = null,
) {
    val l = LocalLedger.current
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        val bank = card?.let(::institutionOf)
        if (bank != null) {
            Box(Modifier.size(36.dp).background(Color(bank.bg), CircleShape), contentAlignment = Alignment.Center) {
                androidx.compose.material3.Icon(androidx.compose.ui.res.painterResource(bank.mark), contentDescription = null, tint = Color(bank.fg), modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(12.dp))
        } else avatar?.let {
            Box(
                Modifier.size(36.dp).background(if (accent) l.accent.copy(alpha = 0.16f) else l.surface2, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (avatarVector != null) {
                    androidx.compose.material3.Icon(avatarVector, contentDescription = null, tint = if (accent) l.accent else l.muted, modifier = Modifier.size(18.dp))
                } else if (avatarIcon != null) {
                    androidx.compose.material3.Icon(androidx.compose.ui.res.painterResource(avatarIcon), contentDescription = null, tint = if (accent) l.accent else l.muted, modifier = Modifier.size(18.dp))
                } else Text(it, color = if (accent) l.accent else l.muted, style = MaterialTheme.typography.labelMedium)
            }
            Spacer(Modifier.width(12.dp))
        }
        // The value shares only the name's line; chips and bars below get the full width, so they
        // don't clip on a small phone with large text.
        Column(Modifier.weight(1f).padding(top = if (avatar != null || bank != null) 6.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                // Two lines before cutting: "Financiamento Carro 13/36" fits on a small phone.
                Text(name, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(12.dp))
                Text(value, color = valueColor, textAlign = TextAlign.End)
                if (open != null) {
                    Spacer(Modifier.width(4.dp))
                    Disclosure(open, l.faint, Modifier.padding(top = 5.dp))
                }
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
    /** The picked column, drawn in ink: green keeps meaning "good", never just "selected" (as on the site). */
    val picked: Boolean = false,
    val faint: Boolean = false,
)

/**
 * Columns from a zero line, scaled to the largest absolute value, like the site's Columns. Display
 * only: the values come from the API, this turns them into heights. Tap a column to pick it.
 */
@Composable
fun Columns(
    items: List<Bar>,
    onSelect: (String) -> Unit,
    guide: Long? = null,
    modifier: Modifier = Modifier,
    height: Dp = 96.dp,
) {
    val l = LocalLedger.current
    val top = maxOf(0L, items.maxOfOrNull { it.value } ?: 0L, guide ?: 0L)
    val bottom = minOf(0L, items.minOfOrNull { it.value } ?: 0L)
    val span = (top - bottom).coerceAtLeast(1L).toFloat()
    val haptics = LocalHapticFeedback.current
    val pick = rememberUpdatedState { n: Int ->
        items.getOrNull(n)?.takeIf { !it.picked }?.let {
            haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
            onSelect(it.key)
        }
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.fillMaxWidth().height(height)) {
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
                        c.picked -> l.text
                        c.faint -> l.faint
                        else -> l.borderInput
                    }
                    Canvas(
                        Modifier.weight(1f).fillMaxSize()
                            .clickable(role = Role.Button) { pick.value(n) }
                            .semantics { contentDescription = c.description; selected = c.picked },
                    ) {
                        val zero = size.height * (top / span)
                        val h = size.height * (kotlin.math.abs(c.value) / span) * grow
                        // A thin pill centred in its slot, as the site's `.columns .bar` (10px, round).
                        val w = 10.dp.toPx().coerceAtMost(size.width)
                        val bar = h.coerceAtLeast(2.dp.toPx())
                        // A forecast month is an outline, told apart by shape, not by a pale fill (as on the site).
                        val line = 1.5.dp.toPx()
                        val inset = if (c.faint && !c.picked) line / 2 else 0f
                        drawRoundRect(
                            color,
                            topLeft = Offset((size.width - w) / 2 + inset, (if (c.value >= 0) zero - bar else zero) + inset),
                            size = androidx.compose.ui.geometry.Size(w - inset * 2, (bar - inset * 2).coerceAtLeast(0f)),
                            cornerRadius = androidx.compose.ui.geometry.CornerRadius(w / 2, w / 2),
                            style = if (inset > 0f) Stroke(width = line) else androidx.compose.ui.graphics.drawscope.Fill,
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
                    color = if (c.picked) l.text else l.faint,
                    style = MaterialTheme.typography.labelMedium,
                    textAlign = TextAlign.Center,
                    // The label belongs to its column: tapping it picks the same month.
                    modifier = Modifier.weight(1f).clearAndSetSemantics {}.clickable { pick.value(n) },
                )
            }
        }
    }
}

/** A save that did not go through, said where it was tried (the site's `.setting-error`). */
@Composable
fun SaveFailed() {
    Text(
        "Não salvou. Tente de novo.",
        color = LocalLedger.current.neg,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.padding(vertical = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/** A small text action, like the site's text links. */
@Composable
fun TextAction(
    text: String,
    onClick: () -> Unit,
    color: Color = LocalLedger.current.muted,
    open: Boolean? = null,
    enabled: Boolean = true,
) {
    // A finger-sized target around a short line of text.
    Row(
        Modifier.clickable(enabled = enabled, onClick = onClick).heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(text, color = color, style = MaterialTheme.typography.labelLarge)
        // A disclosure points down when closed and turns up as it opens, as on the site.
        if (open != null) Disclosure(open, color)
    }
}

/** A disclosure's chevron: points down when closed and turns up as it opens, as on the site. */
@Composable
fun Disclosure(open: Boolean, color: Color, modifier: Modifier = Modifier) {
    val turn by animateFloatAsState(if (open) 180f else 0f, tween(180, easing = Motion.Settle), label = "chevron")
    Canvas(modifier.size(12.dp).graphicsLayer { rotationZ = turn }) {
        val w = size.width
        val path = Path().apply {
            moveTo(w * 0.2f, w * 0.38f)
            lineTo(w * 0.5f, w * 0.66f)
            lineTo(w * 0.8f, w * 0.38f)
        }
        drawPath(path, color, style = Stroke(width = 1.6.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}
