package dev.johnlaff.neko.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.ui.unit.dp
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer

/**
 * The site's motion (styles.css "Motion"): figures arrive once, quickly, and stay still after.
 * Android's "Remove animations" setting scales every duration here to zero, as the site's
 * prefers-reduced-motion does.
 */
object Motion {
    /** Settling curve for bars and arcs drawing in. */
    val Settle = CubicBezierEasing(0.2f, 0.7f, 0.2f, 1f)
    /** Entering screens and rolling digits. */
    val Enter = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
}

/**
 * 0 → 1 once, after [delay] ms: the progress a bar or arc draws with. Once per place: back on a
 * tab, or scrolled back into view, the figure is already there instead of drawing again.
 */
@Composable
fun arrival(duration: Int, delay: Int = 0): Float {
    var done by rememberSaveable { mutableStateOf(false) }
    val a = remember { Animatable(if (done) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!done) {
            a.animateTo(1f, tween(duration, delay, Motion.Settle))
            done = true
        }
    }
    return a.value
}

/** Fades and grows a little into place once, like the site's `appear`. */
@Composable
fun Modifier.appear(duration: Int = 320, delay: Int = 0): Modifier {
    val t = arrival(duration, delay)
    return graphicsLayer {
        alpha = t
        val s = 0.96f + 0.04f * t
        scaleX = s
        scaleY = s
    }
}

/**
 * A tab change: the new screen comes in from the side of the dock it sits on, the old one leaves
 * the other way, shorter than the entry (the site's view transition).
 */
fun tabChange(from: Tab, to: Tab, shift: Int): ContentTransform {
    val dir = if (to.ordinal >= from.ordinal) 1 else -1
    val enter = fadeIn(tween(260, easing = Motion.Enter)) + slideInHorizontally(tween(260, easing = Motion.Enter)) { shift * dir }
    val exit = fadeOut(tween(160, easing = FastOutLinearInEasing)) + slideOutHorizontally(tween(160)) { -shift * 2 / 3 * dir }
    return enter togetherWith exit
}

/** A disclosure's content opening and closing by height, like the site's `details`. */
@Composable
fun ColumnScope.Reveal(visible: Boolean, content: @Composable () -> Unit) {
    AnimatedVisibility(
        visible,
        enter = expandVertically(tween(240, easing = Motion.Settle)) + fadeIn(tween(200)),
        exit = shrinkVertically(tween(200, easing = Motion.Settle)) + fadeOut(tween(150)),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { content() }
    }
}

/** A small hop into place once, for the cat that celebrates a milestone (the site's `hop`). */
@Composable
fun Modifier.hop(): Modifier {
    val t = arrival(900, 200)
    return graphicsLayer {
        // Up past the rest point, then back: a sine over the arrival's 0 → 1.
        translationY = (1f - t) * 6.dp.toPx() - kotlin.math.sin(t * Math.PI).toFloat() * 5.dp.toPx()
        alpha = (t * 3f).coerceAtMost(1f)
    }
}
