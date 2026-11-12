package dev.johnlaff.neko.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.johnlaff.neko.data.Mia2Grafico
import dev.johnlaff.neko.ui.Format.money
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/** A series name at the end of its line, cut to this many letters (the site's END_LABEL). */
private const val END_LABEL = 12

private val PT = Locale.forLanguageTag("pt-BR")

/** About four round steps covering the values (the site's ticksFor in MiaChart). */
internal fun miaTicks(lo: Double, hi: Double): List<Double> {
    val span = max(hi - lo, 1.0)
    val raw = span / 4
    val mag = 10.0.pow(floor(log10(raw)))
    val step = listOf(1.0, 2.0, 2.5, 5.0, 10.0).map { it * mag }.firstOrNull { it >= raw } ?: raw
    val out = mutableListOf<Double>()
    var v = floor(lo / step) * step
    while (true) {
        out += Math.round(v * 100) / 100.0
        if (v >= hi - 1e-9) break
        v += step
    }
    return out
}

/** "12 mil" when the steps are thousands, "2.500" below that; never cents on an axis. */
internal fun miaAxis(reais: Double, step: Double): String {
    if (reais == 0.0) return "0"
    val sign = if (reais < 0) "−" else ""
    val a = abs(reais)
    if (step >= 1000) return "$sign${NumberFormat.getNumberInstance(PT).apply { maximumFractionDigits = 1 }.format(a / 1000)} mil"
    return "$sign${NumberFormat.getIntegerInstance(PT).format(a.roundToInt())}"
}

private fun cents(reais: Double) = Math.round(reais * 100)
private fun short(name: String) = if (name.length > END_LABEL) "${name.take(END_LABEL - 1)}…" else name

/**
 * A chart Mia draws in the conversation (the site's MiaChart): money over time (linha) or side by
 * side (barras), up to three series in a fixed order of color. A finger reads any point; the table
 * under it carries every value, and is what TalkBack reads.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MiaChart(g: Mia2Grafico) {
    val l = LocalLedger.current
    val bars = g.tipo == "barras"
    val n = g.rotulos.size
    val series = g.series
    if (n == 0 || series.isEmpty()) return
    // One series needs no color to tell it apart: it reads in ink, red below zero.
    val colorOf = { k: Int -> if (series.size == 1) l.muted else l.series.getOrElse(k) { l.muted } }
    var table by remember(g) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(g.titulo, color = l.text, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold))
            g.nota?.let { Text(it, color = l.muted, style = MaterialTheme.typography.bodySmall) }
            if (series.size > 1) {
                FlowRow(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    series.forEachIndexed { k, s ->
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Swatch(colorOf(k), bars)
                            Text(s.nome, color = l.muted, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
        Plot(g, bars, colorOf)
        TextAction("Ver em tabela", { table = !table }, open = table)
        if (table) Table(g)
    }
}

/** A series' mark in the legend: a short line for lines, a small rounded square for bars. */
@Composable
private fun Swatch(color: Color, bars: Boolean) {
    if (bars) Spacer(Modifier.size(10.dp).background(color, RoundedCornerShape(3.dp)))
    else Spacer(Modifier.width(14.dp).height(2.dp).background(color))
}

@Composable
private fun Plot(g: Mia2Grafico, bars: Boolean, colorOf: (Int) -> Color) {
    val l = LocalLedger.current
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer(cacheSize = 48)
    val small = TextStyle(fontFamily = Geist, fontSize = 11.sp, color = l.faint)
    val tip = MaterialTheme.typography.labelMedium
    val n = g.rotulos.size
    val series = g.series
    val values = series.flatMap { it.valores }
    val lo0 = values.minOrNull() ?: 0.0
    val hi0 = values.maxOrNull() ?: 0.0
    // Bars stand on zero; a line keeps zero in view only when it is near or crossed.
    val withZero = bars || lo0 < 0 || lo0 < hi0 * 0.3
    val ticks = miaTicks(if (withZero) min(0.0, lo0) else lo0, if (withZero) max(0.0, hi0) else hi0)
    val lo = ticks.first()
    val hi = ticks.last()
    val step = (ticks.getOrNull(1) ?: hi) - lo
    // Names at the ends of the lines, unless two would read the same once cut (the legend says it).
    val ends = !bars && series.size > 1 && series.map { short(it.nome) }.distinct().size == series.size
    var at by remember(g) { mutableStateOf<Int?>(null) }
    // Bars rise from the baseline and lines draw from the left, once, as the chart arrives.
    val grow = remember(g) { Animatable(0f) }
    LaunchedEffect(g) { grow.animateTo(1f, tween(if (bars) 420 else 600, easing = Motion.Settle)) }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val width = constraints.maxWidth.toFloat()
        val px = { d: Float -> with(density) { d.dp.toPx() } }
        val left = ticks.maxOf { measurer.measure(miaAxis(it, step), small).size.width } + px(10f)
        val right = if (ends) min(width * 0.3f, series.maxOf { measurer.measure(short(it.nome), small).size.width } + px(12f)) else px(8f)
        val plotW = width - left - right
        val slot = plotW / n
        // The month names take their own height under the axis, so large text never sits on it.
        val labelH = measurer.measure("jun", small).size.height.toFloat()
        val pick = { x: Float ->
            val i = if (bars) floor((x - left) / slot).toInt() else ((x - left) / plotW * (n - 1)).roundToInt()
            i.coerceIn(0, n - 1)
        }
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(with(density) { (px(158f) + labelH).toDp() })
                .semantics { contentDescription = "${g.titulo}. Os valores estão em Ver em tabela." }
                .pointerInput(g, width) { detectTapGestures { at = if (at == pick(it.x)) null else pick(it.x) } }
                .pointerInput(g, width) {
                    detectHorizontalDragGestures(onDragStart = { at = pick(it.x) }) { change, _ -> at = pick(change.position.x) }
                },
        ) {
            val padTop = px(10f)
            val bottom = size.height - labelH - px(8f)
            val plotH = bottom - padTop
            val y = { v: Double -> (padTop + (hi - v) / (if (hi - lo == 0.0) 1.0 else hi - lo) * plotH).toFloat() }
            val x = { i: Int -> if (bars) left + slot * (i + 0.5f) else left + if (n == 1) plotW / 2 else i.toFloat() / (n - 1) * plotW }
            ticks.forEach { t ->
                val ty = y(t)
                drawLine(if (t == 0.0) l.borderInput else l.border, Offset(left, ty), Offset(size.width - right, ty), px(1f))
                val text = measurer.measure(miaAxis(t, step), small)
                drawText(text, topLeft = Offset(left - px(8f) - text.size.width, ty - text.size.height / 2f))
            }
            // As many labels as fit side by side, evenly skipped when they do not.
            val labelW = g.rotulos.maxOf { measurer.measure(it, small).size.width } + px(12f)
            val every = ceil(n / max(2f, floor(plotW / labelW))).toInt().coerceAtLeast(1)
            g.rotulos.forEachIndexed { i, r ->
                if (i % every != 0) return@forEachIndexed
                val text = measurer.measure(r, small)
                // A line's first and last labels sit inside the plot, never past its edges.
                val tx = when {
                    bars || n == 1 -> x(i) - text.size.width / 2f
                    i == 0 -> x(i)
                    i == n - 1 -> x(i) - text.size.width
                    else -> x(i) - text.size.width / 2f
                }
                drawText(text, topLeft = Offset(tx, bottom + px(6f)))
            }
            val zero = y(0.0)
            val p = grow.value
            if (bars) {
                at?.let { drawRect(l.text.copy(alpha = 0.1f), Offset(left + slot * it, padTop), Size(slot, plotH)) }
                val k = series.size
                val gap = px(2f)
                val groupW = min(slot * 0.72f, px(18f) * k + gap * (k - 1))
                val barW = max(px(2f), (groupW - gap * (k - 1)) / k)
                series.forEachIndexed { s, ser ->
                    ser.valores.forEachIndexed { i, v ->
                        val bx = x(i) - groupW / 2 + s * (barW + gap)
                        val full = y(v)
                        // At least a sliver, so a tiny value still shows which side of zero it is on.
                        val end = if (abs(full - zero) < px(1f)) zero + if (v < 0) px(1f) else -px(1f) else full
                        val e = zero + (end - zero) * p
                        // One series of bars: a month below zero turns red, as everywhere else in the Neko.
                        val color = if (v < 0 && k == 1) l.neg else colorOf(s)
                        drawPath(barPath(bx, barW, zero, e, px(4f)), color)
                    }
                }
            } else {
                val line = Stroke(px(2f), cap = StrokeCap.Round, join = StrokeJoin.Round)
                clipRect(right = left + (plotW + px(8f)) * p) {
                    series.forEachIndexed { s, ser ->
                        val path = Path()
                        ser.valores.forEachIndexed { i, v -> if (i == 0) path.moveTo(x(i), y(v)) else path.lineTo(x(i), y(v)) }
                        drawPath(path, colorOf(s), style = line)
                        if (n <= 12) ser.valores.forEachIndexed { i, v ->
                            drawCircle(l.bg, px(4f) + px(2f), Offset(x(i), y(v)))
                            drawCircle(colorOf(s), px(4f), Offset(x(i), y(v)))
                        }
                    }
                }
                if (ends && p >= 1f) {
                    // End labels, nudged apart so two never sit on each other.
                    var last = Float.NEGATIVE_INFINITY
                    series.mapIndexed { s, ser -> s to y(ser.valores.lastOrNull() ?: 0.0) }.sortedBy { it.second }.forEach { (s, ey) ->
                        val yy = max(ey, last + px(13f))
                        last = yy
                        val text = measurer.measure(short(series[s].nome), small.copy(color = l.muted))
                        drawText(text, topLeft = Offset(size.width - right + px(6f), yy - text.size.height / 2f))
                    }
                }
                at?.let { i ->
                    drawLine(l.faint, Offset(x(i), padTop), Offset(x(i), bottom), px(1f))
                    series.forEachIndexed { s, ser ->
                        val v = ser.valores.getOrElse(i) { 0.0 }
                        drawCircle(l.bg, px(6f), Offset(x(i), y(v)))
                        drawCircle(colorOf(s), px(4f), Offset(x(i), y(v)))
                    }
                }
            }
            // The point read, beside it on the side with more room, so it never covers the marks.
            val i = at ?: return@Canvas
            val rows = buildList {
                add(measurer.measure(g.rotulos[i], tip.copy(color = l.faint)) to null)
                series.forEachIndexed { s, ser ->
                    val v = money(cents(ser.valores.getOrElse(i) { 0.0 }))
                    val text = if (series.size > 1) "$v ${ser.nome}" else v
                    add(measurer.measure(text, tip.copy(color = l.text, fontWeight = FontWeight.SemiBold)) to (if (series.size > 1) colorOf(s) else null))
                }
            }
            val padIn = px(10f)
            val mark = px(20f)
            val w = rows.maxOf { (t, c) -> t.size.width + if (c != null) mark else 0f } + 2 * padIn
            val h = rows.sumOf { it.first.size.height } + 2 * px(8f)
            val cx = x(i)
            val boxLeft = (if (cx > size.width / 2) cx - px(12f) - w else cx + px(12f)).coerceIn(0f, size.width - w)
            val top = px(4f)
            drawRoundRect(l.surface2, Offset(boxLeft, top), Size(w, h), CornerRadius(px(8f)))
            drawRoundRect(l.border, Offset(boxLeft, top), Size(w, h), CornerRadius(px(8f)), style = Stroke(px(1f)))
            var ly = top + px(8f)
            rows.forEach { (t, c) ->
                var tx = boxLeft + padIn
                if (c != null) {
                    val my = ly + t.size.height / 2f
                    if (bars) drawRoundRect(c, Offset(tx, my - px(5f)), Size(px(10f), px(10f)), CornerRadius(px(3f)))
                    else drawLine(c, Offset(tx, my), Offset(tx + px(14f), my), px(2f))
                    tx += mark
                }
                drawText(t, topLeft = Offset(tx, ly))
                ly += t.size.height
            }
        }
    }
}

/** A bar with its data end rounded, standing on the baseline (or hanging from it below zero). */
private fun barPath(x: Float, w: Float, base: Float, end: Float, radius: Float): Path {
    val h = abs(base - end)
    val r = min(min(radius, w / 2), h)
    val up = end <= base
    val d = if (up) 1 else -1
    return Path().apply {
        moveTo(x, base)
        lineTo(x, end + d * r)
        quadraticTo(x, end, x + r, end)
        lineTo(x + w - r, end)
        quadraticTo(x + w, end, x + w, end + d * r)
        lineTo(x + w, base)
        close()
    }
}

/** Every value of the chart, to the cent, as she wrote them. */
@Composable
private fun Table(g: Mia2Grafico) {
    val l = LocalLedger.current
    val style = MaterialTheme.typography.bodyMedium
    Column {
        Row(Modifier.padding(vertical = 6.dp)) {
            Spacer(Modifier.weight(1f))
            g.series.forEach { s ->
                Text(s.nome, Modifier.weight(1.4f), color = l.faint, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.End)
            }
        }
        g.rotulos.forEachIndexed { i, r ->
            HorizontalDivider(color = l.border)
            Row(Modifier.padding(vertical = 6.dp)) {
                Text(r, Modifier.weight(1f), color = l.muted, style = style)
                g.series.forEach { s ->
                    Text(money(cents(s.valores.getOrElse(i) { 0.0 })), Modifier.weight(1.4f), color = l.text, style = style, textAlign = TextAlign.End)
                }
            }
        }
    }
}
