package dev.johnlaff.neko.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.shortDate

/** Whose a purchase is now, and their part of each charge when split (null: all of it). */
internal data class OwnerNow(val person: String, val share: Long?)

/** How someone's part is picked: half, a third, or a value typed in. */
private enum class PartMode { Half, Third, Other }

private const val NEW = "\u0000nova"

/**
 * Whose a purchase is (the site's OwnerForm, web/faturas/Owner.tsx): the owner's, someone named
 * before, or a new name; and, for someone else, all of it or a part ("Dividir o valor": half to
 * start, a third, or another value). A parcel takes its whole plan along and a subscription every
 * month of the same value. Only the owner's part counts in the ceiling; the other part waits in
 * Para lançar as an Entrada.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun OwnerForm(
    /** One charge, in cents. */
    amount: Long,
    current: OwnerNow?,
    /** The plan's length, for a parcel. */
    installments: Int?,
    /** The bill's due day, when known: when the other part enters as an Entrada. */
    due: String?,
    /** A subscription: the mark holds for every month it charges this value. */
    monthly: Boolean,
    people: List<String>,
    /** People whose part goes in when their Pix lands, not on the due day. */
    waits: List<String>,
    onSave: (person: String?, share: Long?, after: (Boolean) -> Unit) -> Unit,
    onDone: () -> Unit,
) {
    val l = LocalLedger.current
    val half = Math.round(amount / 2.0)
    val third = Math.round(amount / 3.0)
    val known = current?.share?.takeIf { it < amount }
    var who by rememberSaveable { mutableStateOf(current?.person) }
    var name by rememberSaveable { mutableStateOf("") }
    var split by rememberSaveable { mutableStateOf(known != null) }
    var mode by rememberSaveable {
        mutableStateOf(if (known == null || known == half) PartMode.Half else if (known == third) PartMode.Third else PartMode.Other)
    }
    var typed by rememberSaveable { mutableStateOf(known?.let(Format::fromCents) ?: "") }
    var saving by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }

    val person = if (who == NEW) name.trim().ifEmpty { null } else who
    val typedCents = Format.toCents(typed)
    val part = if (!split) amount else when (mode) {
        PartMode.Half -> half
        PartMode.Third -> third
        PartMode.Other -> typedCents
    }
    val tooBig = split && mode == PartMode.Other && typedCents != null && typedCents >= amount
    val valid = who == null || (person != null && part != null && part > 0 && (!split || part < amount) && !tooBig)
    val plan = (installments ?: 1) > 1
    val later = person != null && waits.any { it.equals(person, ignoreCase = true) }
    val save = { p: String?, s: Long? ->
        saving = true
        failed = false
        onSave(p, s) { ok ->
            saving = false
            if (ok) onDone() else failed = true
        }
    }
    val submit = submit@{
        if (!valid || saving) return@submit
        if (who == null) {
            if (current == null) onDone() else save(null, null)
            return@submit
        }
        val share = if (split) part else null
        if (current != null && person == current.person && share == known) onDone() else save(person, share)
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        FlowRow(
            Modifier.selectableGroup().semantics { contentDescription = "De quem é" },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            (listOf<String?>(null) + (people + listOfNotNull(current?.person)).distinct() + NEW).forEach { p ->
                Choice(if (p == null) "Minha" else if (p == NEW) "Outra pessoa" else p, who == p) {
                    // A subscription is split more often than given away: it starts split.
                    if (p != null && who == null) split = monthly
                    who = p
                }
            }
        }
        if (who == NEW) {
            val focus = remember { FocusRequester() }
            LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(40) },
                singleLine = true,
                placeholder = { Text("Nome da pessoa", color = l.faint) },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Done),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = l.accent, unfocusedBorderColor = l.borderInput),
                modifier = Modifier.fillMaxWidth().focusRequester(focus).semantics { contentDescription = "Nome da pessoa" },
            )
        }
        if (who != null) {
            // The whole row is the switch, as in Ajustes: a bigger target, read with its state.
            Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp).toggleable(split, role = Role.Switch) { split = it },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Dividir o valor")
                    Text("Uma parte fica com você", color = l.faint, style = MaterialTheme.typography.labelMedium)
                }
                Spacer(Modifier.width(12.dp))
                Switch(checked = split, onCheckedChange = null, colors = switchColors())
            }
        }
        if (who != null && split) {
            FlowRow(
                Modifier.selectableGroup().semantics { contentDescription = "Quanto ${person ?: "a outra pessoa"} paga" },
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(PartMode.Half to "Metade", PartMode.Third to "Um terço", PartMode.Other to "Outro valor").forEach { (k, label) ->
                    Choice(label, mode == k) { mode = k }
                }
            }
            if (mode == PartMode.Other) {
                OutlinedTextField(
                    value = typed,
                    onValueChange = { t -> typed = t.filter { it.isDigit() || it == ',' || it == '.' }.take(12) },
                    singleLine = true,
                    label = { Text("${person ?: "A pessoa"} paga") },
                    prefix = { Text("R$ ", color = l.muted) },
                    placeholder = { Text("0,00", color = l.faint) },
                    isError = tooBig,
                    supportingText = if (tooBig) ({ Text("A parte precisa ser menor que ${money(amount)}.") }) else null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = l.accent, unfocusedBorderColor = l.borderInput),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (part != null && part > 0 && part < amount) {
                val them = person ?: "a outra pessoa"
                SplitBar(amount - part, listOf(part), "Você paga ${money(amount - part)}, $them paga ${money(part)}")
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    LedgerLine("${person ?: "A pessoa"} paga", money(part), color = l.accent)
                    LedgerLine("Você paga", money(amount - part))
                }
            }
        }
        // One line of what the choice does; when the other part enters the sheet, one tap away.
        Text(
            if (who == null) "Conta inteira no seu teto."
            else Format.capitalize(
                listOfNotNull(
                    if (plan) "vale para as $installments parcelas" else null,
                    if (monthly) "vale para todo mês em que cobrar ${money(amount)}" else null,
                    if (split) "só a sua parte conta no teto" else "fica fora do seu teto",
                ).joinToString(" · "),
            ) + ".",
            color = l.muted,
            style = MaterialTheme.typography.bodySmall,
        )
        person?.let { p ->
            var how by rememberSaveable { mutableStateOf(false) }
            TextAction("Como funciona", { how = !how }, open = how)
            Reveal(how) {
                Text(
                    if (later) "A parte de $p entra na planilha quando o Pix cair, em Para lançar."
                    else "A parte de $p aparece em Para lançar como Entrada " +
                        (if (due != null && !monthly && !plan) "em ${shortDate(due)}, quando a fatura vence" else "em cada fatura que ainda vai vencer") +
                        ", e só vai para a planilha quando você tocar em Lançar.",
                    color = l.muted,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        Small(if (saving) "Salvando…" else "Salvar", filled = true, enabled = valid && !saving, modifier = Modifier.fillMaxWidth(), spinning = saving, onClick = submit)
        if (failed) Failed("Não salvou. Toque em Salvar de novo.")
    }
}
