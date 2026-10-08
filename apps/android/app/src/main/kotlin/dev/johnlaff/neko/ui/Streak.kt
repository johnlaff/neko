package dev.johnlaff.neko.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.Habit
import dev.johnlaff.neko.data.HabitDay

private val LETTERS = listOf("D", "S", "T", "Q", "Q", "S", "S")
private val NAMES = listOf("domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado")

private fun stateLabel(state: String) = when (state) {
    "edited" -> "lançado"
    "rest" -> "folga"
    "today" -> "hoje, em aberto"
    "future" -> "ainda não chegou"
    else -> "sem lançar"
}

/**
 * The habit the method asks for, in one quiet line under Lançar, as on the site (web/Streak.tsx):
 * this week as seven marks and the run in words; the rule and the best run behind a tap.
 */
@Composable
fun Streak(h: Habit) {
    val l = LocalLedger.current
    var open by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
        Row(
            Modifier.fillMaxWidth()
                .heightIn(min = 48.dp)
                .clickable(onClickLabel = if (open) "esconder a regra" else "ver a regra") { open = !open }
                .semantics(mergeDescendants = true) { stateDescription = if (open) "Aberto" else "Fechado" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Week(h.week)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(Learn.streakLabel(h.streak), style = MaterialTheme.typography.titleMedium)
                if (h.editedToday) Text("Hoje já lançado", color = l.muted, style = MaterialTheme.typography.bodyMedium)
            }
            // The day is on the sheet: Neko purrs, right where the habit is counted.
            if (h.editedToday) {
                Mascot(Pose.Content, Modifier.height(40.dp).hop())
                Spacer(Modifier.width(8.dp))
            }
            Icon(
                painterResource(R.drawable.ic_chevron_right),
                contentDescription = null,
                tint = l.faint,
                modifier = Modifier.size(16.dp).rotate(if (open) 90f else 0f),
            )
        }
        Reveal(open) {
            Text(Learn.HABIT_RULE, color = l.muted, style = MaterialTheme.typography.bodyMedium)
            val extra = listOfNotNull(
                h.lastWeek?.let { "Semana passada: $it de 7 dias lançados." },
                if (h.best > h.streak) "Melhor sequência: ${h.best} dias." else null,
                h.next?.let { "Próxima marca: $it dias." },
            ).joinToString(" ")
            if (extra.isNotEmpty()) Text(extra, color = l.muted, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun Week(week: List<HabitDay>) {
    val l = LocalLedger.current
    val description = week.mapIndexed { i, d -> "${NAMES.getOrElse(i) { "" }}: ${stateLabel(d.state)}" }.joinToString(", ")
    Row(
        Modifier.semantics { contentDescription = "Esta semana. $description" },
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        week.forEachIndexed { i, d ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Mark(d.state, delay = i * 30)
                Text(
                    LETTERS.getOrElse(i) { "" },
                    color = if (d.state == "today") l.text else l.faint,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}

/** One day: filled when the sheet changed, dashed on a rest day, ringed for today. */
@Composable
private fun Mark(state: String, delay: Int) {
    val l = LocalLedger.current
    var shown by rememberSaveable { mutableStateOf(state != "edited") }
    val scale = remember { Animatable(if (shown) 1f else 0.3f) }
    LaunchedEffect(Unit) {
        if (!shown) {
            kotlinx.coroutines.delay(delay.toLong())
            scale.animateTo(1f, spring(dampingRatio = 1f, stiffness = 500f))
            shown = true
        }
    }
    Canvas(Modifier.size(16.dp).graphicsLayer { scaleX = scale.value; scaleY = scale.value }) {
        val r = 5.dp.toPx()
        val c = Offset(size.width / 2, size.height / 2)
        val stroke = 1.5.dp.toPx()
        when (state) {
            "edited" -> drawCircle(l.text, r, c)
            "rest" -> drawCircle(
                l.muted,
                r,
                c,
                style = Stroke(stroke, pathEffect = PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 2.dp.toPx()))),
            )
            "today" -> {
                drawCircle(l.accent.copy(alpha = 0.18f), r + 3.dp.toPx(), c)
                drawCircle(l.accent, r, c, style = Stroke(stroke))
            }
            "future" -> drawCircle(l.border, r, c, style = Stroke(stroke))
            else -> drawCircle(l.faint, r, c, style = Stroke(stroke))
        }
    }
}

/** The day a run reaches a mark: a soft tick in the hand, once on this phone. */
@Composable
fun MilestoneHaptic(milestone: Int) {
    val haptics = LocalHapticFeedback.current
    var felt by rememberSaveable(milestone) { mutableStateOf(false) }
    LaunchedEffect(milestone) {
        if (!felt) {
            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
            felt = true
        }
    }
}
