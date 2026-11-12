package dev.johnlaff.neko.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.CanSpend
import dev.johnlaff.neko.data.SimulatedCycle

/** A pill to pick one option, pressed when chosen; it takes its new colors quickly, as on the site. */
@Composable
internal fun Choice(text: String, on: Boolean, fill: Boolean = false, onClick: () -> Unit) {
    val l = LocalLedger.current
    val haptics = LocalHapticFeedback.current
    val shape = RoundedCornerShape(50)
    val ease = tween<Color>(160, easing = LinearOutSlowInEasing)
    val ink by animateColorAsState(if (on) l.bg else l.text, ease, label = "ink")
    val fillColor by animateColorAsState(if (on) l.text else l.surface2, ease, label = "fill")
    val edge by animateColorAsState(if (on) l.text else l.border, ease, label = "edge")
    Text(
        text,
        color = ink,
        style = MaterialTheme.typography.labelLarge,
        textAlign = if (fill) androidx.compose.ui.text.style.TextAlign.Center else null,
        maxLines = 1,
        // Never broken inside: with big text a row of pills wraps whole pills instead.
        softWrap = false,
        // The pill stays small; the touch area around it is a finger's. Filled, it takes its share
        // of a row, as the site's segmented chips do.
        modifier = Modifier
            .then(if (fill) Modifier.fillMaxWidth() else Modifier)
            .minimumInteractiveComponentSize()
            .background(fillColor, shape)
            .border(1.dp, edge, shape)
            .selectable(on, role = Role.RadioButton) {
                if (!on) haptics.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick)
                onClick()
            }
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

/** The same pill as an on/off mark (a subscription to cancel); `label` names it for TalkBack. */
@Composable
internal fun Toggle(text: String, on: Boolean, label: String, onClick: () -> Unit) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(50)
    Text(
        text,
        color = if (on) l.pos else l.text,
        style = MaterialTheme.typography.labelLarge,
        modifier = Modifier
            .minimumInteractiveComponentSize()
            .background(if (on) l.bg else l.surface2, shape)
            .border(1.dp, if (on) l.pos else l.border, shape)
            .toggleable(on, role = Role.Checkbox) { onClick() }
            .semantics { contentDescription = label }
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

internal data class SimFigure(val label: String, val amount: Long, val over: Boolean)

/**
 * A purchase's own figure in Simular, as on the site: what still fits, as on the dial, or by how much
 * the plan (or the cards' ceiling) is passed. Before a value is typed it speaks for things as they
 * are, which may already be over; after, for what is left once the purchase is made. Never per day.
 */
internal fun simFigure(cs: CanSpend, cycle: SimulatedCycle?): SimFigure = simFigure(cs.mode, cs.left, cs.overBy, cycle)

internal fun simFigure(mode: String, left: Long, overBy: Long, cycle: SimulatedCycle?): SimFigure {
    val past = if (mode == "cards") "Passa do teto" else "Passa do plano"
    return when {
        cycle == null && overBy > 0 -> SimFigure(past, overBy, true)
        cycle == null -> SimFigure("Ainda cabem", left, false)
        cycle.remaining < 0 -> SimFigure(past, -cycle.remaining, true)
        else -> SimFigure("Ainda cabem", cycle.remaining, false)
    }
}
