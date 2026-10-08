package dev.johnlaff.neko.ui

import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.foundation.layout.RowScope
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.cos
import kotlin.math.sin

/** A hairline-bordered panel, the site's `.panel`. */
@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier
            .fillMaxWidth()
            .background(l.surface, shape)
            .border(1.dp, l.border, shape)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

/** Title on the left, a chip or a count on the right; the chip drops below when both don't fit. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PanelHead(title: String, trailing: @Composable () -> Unit = {}) {
    // A wide chip ("R$ 1.023,02 abaixo da média") used to squeeze the title to "His…" on a small
    // phone; wrapping keeps both whole.
    FlowRow(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalArrangement = Arrangement.spacedBy(6.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(end = 8.dp).semantics { heading() })
        trailing()
    }
}

enum class ChipTone { Ok, Warn, Bad, Plain }

@Composable
fun Chip(text: String, tone: ChipTone) {
    val l = LocalLedger.current
    val color = when (tone) {
        ChipTone.Ok -> l.pos
        ChipTone.Warn -> l.warn
        ChipTone.Bad -> l.neg
        ChipTone.Plain -> l.muted
    }
    val shape = RoundedCornerShape(50)
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        maxLines = 1,
        softWrap = false,
        modifier = Modifier
            .background(color.copy(alpha = 0.12f), shape)
            .padding(horizontal = 10.dp, vertical = 3.dp),
    )
}

/**
 * `R$ 847,00` as a figure: small currency, big integer, small cents, like the site's BigMoney.
 * The integer's digits are odometer wheels (site's Figures.tsx): each rolls to its value when the
 * figure first shows or changes, the rightmost first.
 */
@Composable
fun BigMoney(cents: Long, color: Color = LocalLedger.current.text) {
    val text = Format.money(cents)
    val m = Regex("""^(−?)R\$[\s\u00A0]([\d.]+)(,\d{2})$""").find(text)
    val base = MaterialTheme.typography.bodyLarge.copy(fontFamily = Geist, lineHeight = 52.sp, color = color)
    val describe = Modifier.clearAndSetSemantics { contentDescription = text }
    if (m == null) {
        Text(text, style = base, modifier = describe)
        return
    }
    val small = base.copy(fontSize = 20.sp)
    val big = base.copy(fontSize = 48.sp, fontWeight = FontWeight.Medium)
    val int = m.groupValues[2]
    val digits = int.count { it.isDigit() }
    Row(describe) {
        Text("${m.groupValues[1]}R$ ", style = small, modifier = Modifier.alignByBaseline())
        var seen = 0
        int.forEach { ch ->
            if (ch.isDigit()) {
                val fromRight = digits - 1 - seen++
                Wheel(ch.digitToInt(), big, delay = minOf(fromRight, 2) * 30)
            } else {
                Text(ch.toString(), style = big, modifier = Modifier.alignByBaseline())
            }
        }
        Text(m.groupValues[3], style = small, modifier = Modifier.alignByBaseline())
    }
}

/** One digit: an invisible face holds width and baseline; the strip 0–9 slides under a clip. */
@Composable
private fun RowScope.Wheel(digit: Int, style: TextStyle, delay: Int) {
    val roll = remember { Animatable(0f) }
    LaunchedEffect(digit) { roll.animateTo(digit.toFloat(), tween(480, delay, Motion.Enter)) }
    val measurer = rememberTextMeasurer()
    val strip = remember(style, measurer) { (0..9).map { measurer.measure(it.toString(), style) } }
    Text(
        digit.toString(),
        style = style.copy(color = Color.Transparent),
        modifier = Modifier.alignByBaseline().drawWithContent {
            val h = size.height
            clipRect {
                (0..9).forEach { i ->
                    val y = (i - roll.value) * h
                    if (y > -h && y < h) {
                        val face = strip[i]
                        drawText(face, topLeft = Offset((size.width - face.size.width) / 2f, y + (h - face.size.height) / 2f))
                    }
                }
            }
        },
    )
}

/** Half-circle gauge: how much of the cycle budget is on the bill, with the pace tick on it. */
@Composable
fun Gauge(value: Long, total: Long, mark: Long, over: Boolean, modifier: Modifier = Modifier, bad: Boolean = false) {
    val l = LocalLedger.current
    val target = if (total <= 0) 0f else (value.toFloat() / total).coerceIn(0f, 1f)
    val at = if (total <= 0) 0f else (mark.toFloat() / total).coerceIn(0f, 1f)
    // The arc draws in once; a new reading moves it from where it was, also after a tab change.
    var drawn by rememberSaveable { mutableFloatStateOf(0f) }
    val fill = remember { Animatable(drawn) }
    LaunchedEffect(target) {
        fill.animateTo(target, tween(600, easing = Motion.Settle))
        drawn = target
    }
    val share = fill.value
    val tickIn = arrival(240, delay = 300)
    Canvas(modifier) {
        val stroke = size.width * 0.06f
        val r = (size.width - stroke) / 2
        val box = Size(r * 2, r * 2)
        val topLeft = Offset(stroke / 2, stroke / 2)
        val style = Stroke(width = stroke, cap = StrokeCap.Round)
        drawArc(l.border, 180f, 180f, false, topLeft, box, style = style)
        if (share > 0f) drawArc(if (bad) l.neg else if (over) l.warn else l.accent, 180f, 180f * share, false, topLeft, box, style = style)
        val angle = Math.PI * (1 - at)
        val c = Offset(size.width / 2, stroke / 2 + r)
        val tick = Offset(c.x + r * cos(angle).toFloat(), c.y - r * sin(angle).toFloat())
        drawCircle(l.bg, radius = stroke * 0.75f * (0.4f + 0.6f * tickIn), center = tick, alpha = tickIn)
        drawCircle(l.text, radius = stroke * 0.5f * (0.4f + 0.6f * tickIn), center = tick, alpha = tickIn)
    }
}
