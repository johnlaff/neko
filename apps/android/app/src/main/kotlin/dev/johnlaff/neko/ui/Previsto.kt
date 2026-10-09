package dev.johnlaff.neko.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.PrevistoView
import dev.johnlaff.neko.ui.Format.days
import dev.johnlaff.neko.ui.Format.fromCents
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.shortDate
import dev.johnlaff.neko.ui.Format.toCents
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The Diário previsto (specs/005-lancamentos, Fase 3), as on the site (web/Previsto.tsx): the value
 * to fill the days ahead with, in Ajustes, and the review on Hoje every 3 months. The values come
 * from the Worker; nothing here computes one.
 */

/** Ajustes › Planilha, under the switch: the value per day, or taking the forecast away. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PrevistoForm(p: PrevistoView, off: Boolean, set: suspend (Long) -> Unit, onClose: () -> Unit) {
    val l = LocalLedger.current
    val scope = rememberCoroutineScope()
    val start: Long = if (p.on) p.value else p.suggestion?.perDay ?: 0L
    var typed by rememberSaveable { mutableStateOf(if (start > 0) fromCents(start) else "") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var formula by remember { mutableStateOf(false) }
    val amount = toCents(typed)
    // As in Ritmo, a wrong value is pointed out once you leave the field, not while typing.
    var left by rememberSaveable { mutableStateOf(false) }
    var focused by remember { mutableStateOf(false) }
    val bad = left && typed.isNotBlank() && (amount == null || amount <= 0)
    // The form grows (Como calculei, the error): once it has, keep its buttons in sight and clear
    // of the floating dock.
    val buttons = remember { BringIntoViewRequester() }
    var buttonsSize by remember { mutableStateOf(IntSize.Zero) }
    val dock = with(LocalDensity.current) { (if (LocalRail.current) 0.dp else DOCK_ROOM).toPx() }
    LaunchedEffect(formula, bad) {
        delay(260)
        buttons.bringIntoView(Rect(0f, 0f, buttonsSize.width.toFloat(), buttonsSize.height + dock))
    }

    fun submit(value: Long) {
        left = true
        busy = true
        error = null
        scope.launch {
            runCatching { set(value) }.fold({ onClose() }, { error = reasonOf(it) })
            busy = false
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (off) {
            Text("O previsto sai dos dias que vêm. O que você escreveu no Diário fica como está.", color = l.muted, style = MaterialTheme.typography.bodyMedium)
        } else {
            p.suggestion?.let { s ->
                Text("Pelo banco, um dia seu custa ${money(s.perDay)}.")
                Column(Modifier.semantics { stateDescription = if (formula) "Aberto" else "Fechado" }) {
                    TextAction(if (formula) "Esconder a conta" else "Como calculei", { formula = !formula }, open = formula)
                    Reveal(formula) {
                        Text(
                            "Desde ${shortDate(s.from)}: ${money(s.cards)} em compras nos seus cartões e ${money(s.pix)} em Pix e " +
                                "débito, sem o que a planilha já planeja, divididos por ${days(s.days)}. Compra parcelada conta " +
                                "inteira no dia em que foi feita.",
                            color = l.muted,
                        )
                    }
                }
            }
            OutlinedTextField(
                value = typed,
                onValueChange = { typed = it },
                label = { Text("Valor por dia") },
                singleLine = true,
                prefix = { Text("R$ ", color = l.faint) },
                placeholder = { Text("0,00", color = l.faint) },
                isError = bad,
                supportingText = if (bad) ({ Text("Use um valor como 95,00") }) else null,
                textStyle = MaterialTheme.typography.headlineSmall,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = l.accent, unfocusedBorderColor = l.borderInput),
                modifier = Modifier.fillMaxWidth().onFocusChanged {
                    if (focused && !it.isFocused) left = true
                    focused = it.isFocused
                },
            )
            Text(
                "Cada dia de hoje até dezembro de ${p.lastYear} recebe esse valor no Diário, com a nota Previsto. " +
                    "O que você escreveu no Diário fica como está.",
                color = l.muted,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        error?.let { Failed(it) }
        FlowRow(
            Modifier.bringIntoViewRequester(buttons).onSizeChanged { buttonsSize = it },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (off) Small(if (busy) "Apagando…" else "Apagar o previsto", filled = true, enabled = !busy) { submit(0L) }
            else Small(
                if (busy) "Gravando…" else if (p.on) "Trocar" else "Preencher",
                filled = true,
                enabled = amount != null && amount > 0 && !busy,
            ) { amount?.let { submit(it) } }
            Small("Cancelar", filled = false, onClick = onClose)
        }
    }
}

/** Hoje, every 3 months: what a day really cost beside the value, and whether to change it. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun PrevistoReview(p: PrevistoView?, launcher: Launcher?, onLaunched: (String) -> Unit = {}) {
    val l = LocalLedger.current
    val r = p?.review
    if (p == null || !p.on || r == null) return
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    fun act(what: String, block: suspend (Launcher) -> Unit) {
        val go = launcher ?: return
        busy = what
        error = null
        scope.launch {
            runCatching { block(go) }.onFailure { error = reasonOf(it) }
            busy = null
        }
    }

    Panel {
        PanelHead("Diário previsto") {
            Text("A cada 3 meses", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            ReviewLine("Previsto por dia", money(p.value))
            ReviewLine("Gasto por dia desde ${shortDate(r.from)}", money(r.real))
        }
        if (launcher != null) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (r.real != p.value)
                    Small(if (busy == "change") "Trocando…" else "Trocar para ${money(r.real)}", filled = true, enabled = busy == null) {
                        act("change") { onLaunched(it.previsto(r.real)) }
                    }
                Small("Manter ${money(p.value)}", filled = false, enabled = busy == null) {
                    act("keep") { it.keepPrevisto() }
                }
            }
        }
        error?.let { Failed(it) }
    }
}

@Composable
private fun ReviewLine(label: String, value: String) {
    val l = LocalLedger.current
    Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, Modifier.weight(1f), color = l.muted)
        Text(value)
    }
}
