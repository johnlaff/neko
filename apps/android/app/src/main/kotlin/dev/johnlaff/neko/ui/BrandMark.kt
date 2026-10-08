package dev.johnlaff.neko.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The mark's box inside the 108 icon grid: just the line and the eyes, without the bleed. */
private const val BOX_X = 14f
private const val BOX_Y = 31f
private const val BOX_W = 80f
private const val BOX_H = 52f

/**
 * The brand mark, the same drawing as the app icon (res/drawable/ic_launcher_foreground.xml)
 * and the site (web/BrandMark.tsx): a month's balance line that rises into two ears and ends
 * higher than it began, with slit pupils. Here the line stops short of the edges.
 * Decorative: the name "Neko" always sits next to it.
 */
@Composable
fun BrandMark(modifier: Modifier = Modifier, line: Color = LocalLedger.current.text, eyes: Color = LocalLedger.current.accent) {
    val path = remember { PathParser().parsePathString("M18,78 L30,78 L35,37 L48,50 L58,50 L71,37 L76,66 L90,66").toPath() }
    Canvas(modifier.aspectRatio(BOX_W / BOX_H)) {
        val k = size.width / BOX_W
        scale(k, pivot = Offset.Zero) {
            translate(-BOX_X, -BOX_Y) {
                drawPath(path, line, style = Stroke(width = 6f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                for (x in listOf(46.5f, 59.5f)) drawOval(eyes, Offset(x - 2.4f, 56f), Size(4.8f, 11f))
            }
        }
    }
}

/** The mark in faint ink, for a screen with nothing to show yet or a read that failed. */
@Composable
fun QuietMark(width: Dp, modifier: Modifier = Modifier) {
    val faint = LocalLedger.current.faint
    BrandMark(modifier.width(width), line = faint, eyes = faint)
}

/** Mia wears the same mark with her amber eyes. */
@Composable
fun MiaMark(width: Dp, modifier: Modifier = Modifier) = BrandMark(modifier.width(width), eyes = LocalLedger.current.mia)

/** The small "i" in a ring that opens a tip, where Mia's picture used to sit. */
@Composable
fun TipMark(modifier: Modifier = Modifier) {
    val muted = LocalLedger.current.muted
    Box(modifier.size(20.dp).border(1.dp, muted, CircleShape), contentAlignment = Alignment.Center) {
        Text("i", color = muted, fontFamily = Faustina, fontStyle = FontStyle.Italic, fontSize = 13.sp, lineHeight = 13.sp)
    }
}
