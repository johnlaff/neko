package dev.johnlaff.neko.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
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

/** Title on the left, a chip or a count on the right. */
@Composable
fun PanelHead(title: String, trailing: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium)
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

/** `R$ 847,00` as a figure: small currency, big integer, small cents, like the site's BigMoney. */
@Composable
fun BigMoney(cents: Long, color: Color = LocalLedger.current.text) {
    val text = Format.money(cents)
    val m = Regex("""^(−?)R\$ ([\d.]+)(,\d{2})$""").find(text)
    val styled = buildAnnotatedString {
        if (m == null) {
            append(text)
        } else {
            withStyle(SpanStyle(fontSize = 20.sp)) { append("${m.groupValues[1]}R$ ") }
            withStyle(SpanStyle(fontSize = 48.sp, fontWeight = FontWeight.Medium)) { append(m.groupValues[2]) }
            withStyle(SpanStyle(fontSize = 20.sp)) { append(m.groupValues[3]) }
        }
    }
    Text(
        styled,
        color = color,
        style = MaterialTheme.typography.bodyLarge.copy(fontFamily = Geist, lineHeight = 52.sp),
        modifier = Modifier.clearAndSetSemantics { contentDescription = text },
    )
}

/** Half-circle gauge: how much of the cycle budget is on the bill, with the pace tick on it. */
@Composable
fun Gauge(value: Long, total: Long, mark: Long, over: Boolean, modifier: Modifier = Modifier) {
    val l = LocalLedger.current
    val share = if (total <= 0) 0f else (value.toFloat() / total).coerceIn(0f, 1f)
    val at = if (total <= 0) 0f else (mark.toFloat() / total).coerceIn(0f, 1f)
    Canvas(modifier) {
        val stroke = size.width * 0.06f
        val r = (size.width - stroke) / 2
        val box = Size(r * 2, r * 2)
        val topLeft = Offset(stroke / 2, stroke / 2)
        val style = Stroke(width = stroke, cap = StrokeCap.Round)
        drawArc(l.border, 180f, 180f, false, topLeft, box, style = style)
        if (share > 0f) drawArc(if (over) l.warn else l.accent, 180f, 180f * share, false, topLeft, box, style = style)
        val angle = Math.PI * (1 - at)
        val c = Offset(size.width / 2, stroke / 2 + r)
        val tick = Offset(c.x + r * cos(angle).toFloat(), c.y - r * sin(angle).toFloat())
        drawCircle(l.bg, radius = stroke * 0.75f, center = tick)
        drawCircle(l.text, radius = stroke * 0.5f, center = tick)
    }
}
