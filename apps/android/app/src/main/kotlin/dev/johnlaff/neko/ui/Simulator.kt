package dev.johnlaff.neko.ui

import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.CanSpend
import dev.johnlaff.neko.data.InstallmentSimulation
import dev.johnlaff.neko.data.SimulatedCycle
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.monthName
import dev.johnlaff.neko.ui.Format.shortDate
import dev.johnlaff.neko.ui.Format.toCents
import kotlinx.coroutines.delay

/** Asks the Worker how a purchase lands; null when there is no usual card or no connection. */
typealias Simulate = suspend (amount: Long, count: Int) -> InstallmentSimulation?

/** Common purchase sizes, one tap away. */
private val PRESETS = listOf(50, 100, 250, 500)
/** How Brazilian stores usually split a card purchase. */
private val PARCELS = listOf(1, 2, 3, 6, 10, 12)
/** Waits for typing to pause before asking the Worker. */
private const val TYPING_PAUSE = 300L

private fun monthLabel(year: Int, month: Int) = "${capitalize(monthName(month)).take(3)} ${year.toString().takeLast(2)}"

/**
 * The site's "Simular compra" (web/Pace.tsx): "e se eu comprar R$ X hoje, em N vezes?". The
 * Worker answers with the engine's simulation; the screen only formats it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Simulator(
    cs: CanSpend,
    simulate: Simulate,
    startTyped: String = "",
    startCount: Int = 1,
) {
    val l = LocalLedger.current
    var typed by rememberSaveable { mutableStateOf(startTyped) }
    var count by rememberSaveable { mutableStateOf(startCount) }
    var sim by remember { mutableStateOf<InstallmentSimulation?>(null) }
    // Only typing waits for a pause; a tapped preset or parcel count asks at once.
    var typing by remember { mutableStateOf(false) }
    val amount = toCents(typed)?.takeIf { it > 0 }
    LaunchedEffect(amount, count) {
        if (amount == null) {
            sim = null
            return@LaunchedEffect
        }
        if (typing) delay(TYPING_PAUSE)
        // Offline keeps the last answer on screen rather than flashing it away.
        runCatching { simulate(amount, count) }.onSuccess { sim = it }
    }
    // An answer for an older amount stays until the new one lands, as on the site's live figure.
    val cycle = sim?.cycle.takeIf { amount != null }
    val parcel = sim?.parcels?.firstOrNull()
    val last = sim?.parcels?.lastOrNull()?.due
    val red = sim?.firstNegative

    Panel {
        Text("Valor da compra no ${cs.card}", color = l.muted, style = MaterialTheme.typography.labelLarge)
        OutlinedTextField(
            value = typed,
            onValueChange = {
                typing = true
                typed = it
            },
            singleLine = true,
            prefix = { Text("R$ ", color = l.faint) },
            placeholder = { Text("0,00", color = l.faint) },
            textStyle = MaterialTheme.typography.headlineSmall,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = l.accent, unfocusedBorderColor = l.borderInput),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Valor da compra" },
        )
        FlowRow(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PRESETS.forEach { v -> Choice("$v", typed == "$v,00") {
                typing = false
                typed = "$v,00"
            } }
        }
        Text("Parcelas", color = l.muted, style = MaterialTheme.typography.labelLarge)
        FlowRow(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            PARCELS.forEach { n -> Choice(if (n == 1) "À vista" else "$n×", count == n) {
                typing = false
                count = n
            } }
        }
        Row(Modifier.fillMaxWidth()) {
            val fig = simFigure(cs, cycle)
            // One firm buzz when a typed purchase tips the cycle over the plan, not on every keystroke.
            val haptics = LocalHapticFeedback.current
            LaunchedEffect(fig.over && cycle != null) {
                if (fig.over && cycle != null) haptics.performHapticFeedback(HapticFeedbackType.Reject)
            }
            Figure(fig.label, money(fig.amount), if (fig.over) l.neg else l.text, Modifier.weight(1f))
            if (sim != null && count > 1 && parcel != null) {
                Figure("$count× de", money(parcel.amount), l.text, Modifier.weight(1f))
            } else {
                Figure("Sai da conta", shortDate(cycle?.due ?: cs.due), l.text, Modifier.weight(1f))
            }
        }
        val s = sim
        if (s != null && amount != null && (red != null || s.lowest != null || count > 1)) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (red != null) {
                    Text(
                        red.date?.let { "Fica no vermelho em ${shortDate(it)}: ${money(red.end)}" }
                            ?: "${capitalize(monthName(red.month))} termina no vermelho: ${money(red.end)}",
                        color = l.neg,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                } else {
                    s.lowest?.let { lo ->
                        Text(
                            lo.date?.let { "Menor saldo: ${shortDate(it)}, ${money(lo.end)}" }
                                ?: "Menor fim de mês: ${monthLabel(lo.year, lo.month)}, ${money(lo.end)}",
                            color = l.muted,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
                if (count > 1 && last != null) {
                    Text(
                        "Última parcela em ${shortDate(last)} de ${last.take(4)}",
                        color = l.muted,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun Figure(label: String, value: String, color: androidx.compose.ui.graphics.Color, modifier: Modifier) {
    val l = LocalLedger.current
    Column(modifier) {
        Text(label, color = l.muted, style = MaterialTheme.typography.labelMedium)
        Text(value, color = color, style = MaterialTheme.typography.titleLarge)
    }
}

/** A pill to pick one option, pressed when chosen. */
@Composable
private fun Choice(text: String, on: Boolean, onClick: () -> Unit) {
    val l = LocalLedger.current
    val haptics = LocalHapticFeedback.current
    val shape = RoundedCornerShape(50)
    Text(
        text,
        color = if (on) l.bg else l.text,
        style = MaterialTheme.typography.labelLarge,
        // The pill stays small; the touch area around it is a finger's.
        modifier = Modifier
            .minimumInteractiveComponentSize()
            .background(if (on) l.text else l.surface2, shape)
            .border(1.dp, if (on) l.text else l.border, shape)
            .selectable(on, role = Role.RadioButton) {
                if (!on) haptics.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick)
                onClick()
            }
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

internal data class SimFigure(val label: String, val amount: Long, val over: Boolean)

/**
 * The simulator's first figure: what is left per day, or by how much the cycle goes over the
 * plan. Before a value is typed it speaks for the card as it is, which may already be over.
 */
internal fun simFigure(cs: CanSpend, cycle: SimulatedCycle?): SimFigure = when {
    cycle == null && cs.perDay < 0 -> SimFigure("Passa do plano", cs.overBy, true)
    cycle == null -> SimFigure("Sobra por dia", cs.perDay, false)
    cycle.perDay < 0 -> SimFigure("Passa do plano", -cycle.remaining, true)
    else -> SimFigure("Sobra por dia", cycle.perDay, false)
}
