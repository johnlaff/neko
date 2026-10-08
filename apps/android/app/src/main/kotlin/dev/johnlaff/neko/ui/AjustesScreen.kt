package dev.johnlaff.neko.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.AjustesView
import dev.johnlaff.neko.data.CardConfig
import dev.johnlaff.neko.data.CardDays
import dev.johnlaff.neko.data.UserSettings
import dev.johnlaff.neko.ui.Format.fromCents
import dev.johnlaff.neko.ui.Format.toCents
import kotlinx.coroutines.delay

/** How long typing must pause before a typed field saves on its own, as on the site. */
private const val TYPING_PAUSE = 1200L

private fun badMoney(s: String) = s.isNotBlank() && toCents(s) == null

private fun badDay(s: String?) = !s.isNullOrBlank() && s.trim().toIntOrNull().let { it == null || it !in 1..31 }

/** What the fields hold, as typed. Lives above the list so scrolling never drops an edit. */
class AjustesForm(v: AjustesView) {
    val cards: List<CardConfig> = v.cards
    private val reviewed = v.settings.reviewed
    var daily by mutableStateOf(fromCents(v.settings.dailyForecast))
    var budget by mutableStateOf(fromCents(v.settings.cycleBudget))
    var usual by mutableStateOf(v.settings.usualCard ?: "")
    val closing = mutableStateMapOf<String, String>().apply { v.settings.cards.forEach { put(it.name, it.closingDay.toString()) } }
    val others = mutableStateListOf<String>().apply { addAll(v.settings.othersCards) }
    /** Fields left at least once: only those say they are wrong. */
    val left = mutableStateListOf<String>()
    /** Set by a switch, a picker or leaving a field: save without waiting for typing to stop. */
    var now by mutableStateOf(false)
    var lastSent: UserSettings? = null

    fun invalid() = badMoney(daily) || badMoney(budget) || cards.any { badDay(closing[it.name]) }

    /** The settings to send, as the site builds them; null while a field is invalid. */
    fun payload(): UserSettings? = if (invalid()) null else UserSettings(
        dailyForecast = toCents(daily),
        cycleBudget = toCents(budget),
        usualCard = usual.ifEmpty { null },
        othersCards = others.toList(),
        cards = cards.mapNotNull { c ->
            closing[c.name]?.trim()?.takeIf { it.isNotEmpty() }?.let { CardDays(c.name, it.toInt(), c.dueDay) }
        },
        // Checked Conferência points are set on the site's Hoje; saving here keeps them.
        reviewed = reviewed,
    )

    init {
        lastSent = payload()
    }
}

/**
 * The site's Ajustes (web/screens/Ajustes.tsx) as a grouped list that saves itself: a switch or a
 * picker at once, a typed field when it loses focus or a moment after typing stops.
 */
@Composable
fun AjustesScreen(
    state: ScreenState<AjustesView>,
    save: SaveState,
    onRefresh: () -> Unit,
    onSave: (UserSettings) -> Unit,
    onLogout: () -> Unit,
    reminders: RemindersSwitch = RemindersSwitch(),
) {
    val v = state.view
    val form = remember(v != null) { v?.let(::AjustesForm) }
    val payload = form?.payload()
    LaunchedEffect(payload, form?.now) {
        val f = form ?: return@LaunchedEffect
        val send = payload?.takeIf { it != f.lastSent }
        if (send == null) {
            f.now = false
            return@LaunchedEffect
        }
        if (!f.now) delay(TYPING_PAUSE)
        f.now = false
        f.lastSent = send
        onSave(send)
    }
    ScreenFrame(
        "Ajustes",
        state,
        { "" },
        onRefresh,
        trailing = {
            when (save) {
                SaveState.Idle -> Unit
                SaveState.Saving -> Chip("Salvando…", ChipTone.Plain)
                SaveState.Saved -> Chip("Salvo", ChipTone.Ok)
                SaveState.Failed -> Chip("Não salvou", ChipTone.Bad)
            }
        },
    ) { view ->
        val f = form ?: return@ScreenFrame
        item { Group("Ritmo") { Pace(f, view.dailyAuto) } }
        if (f.cards.isNotEmpty()) item { Group("Cartões") { Cards(f) } }
        item { Group("Lembretes") { Reminders(reminders) } }
        item {
            Panel {
                TextAction("Sair deste aparelho", onLogout, LocalLedger.current.neg)
            }
        }
    }
}

/** The phone's own reminders: a setting of this device, not of the account, so it is not saved. */
data class RemindersSwitch(
    val on: Boolean = false,
    /** Android refused notifications to the app; only its settings can undo that. */
    val blocked: Boolean = false,
    val onChange: (Boolean) -> Unit = {},
)

@Composable
private fun Reminders(r: RemindersSwitch) {
    val l = LocalLedger.current
    Setting(
        "Neste celular",
        when {
            r.blocked -> "Permita as notificações do Neko no Android"
            // The site's browser push sends the same two reminders; both on would arrive twice.
            r.on -> "Às 8h e às 21h. Desligue os do site neste celular"
            else -> "Quanto cabe às 8h, lançar o dia às 21h"
        },
        r.blocked,
    ) {
        Switch(
            checked = r.on,
            onCheckedChange = r.onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = l.accent, checkedThumbColor = l.bg),
            modifier = Modifier.semantics { contentDescription = "Lembretes neste celular" },
        )
    }
}

@Composable
private fun Group(title: String, content: @Composable () -> Unit) {
    val l = LocalLedger.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, color = l.muted, style = MaterialTheme.typography.labelLarge)
        Panel { content() }
    }
}

@Composable
private fun Setting(label: String, sub: String, error: Boolean = false, control: @Composable () -> Unit) {
    val l = LocalLedger.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label)
            Text(sub, color = if (error) l.neg else l.faint, style = MaterialTheme.typography.labelMedium)
        }
        Spacer(Modifier.width(12.dp))
        control()
    }
}

@Composable
private fun Field(
    value: String,
    onChange: (String) -> Unit,
    onLeave: () -> Unit,
    placeholder: String,
    description: String,
    money: Boolean,
    error: Boolean,
    width: Int,
) {
    val l = LocalLedger.current
    var focused by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        isError = error,
        prefix = if (money) ({ Text("R$ ", color = l.faint) }) else null,
        placeholder = { Text(placeholder, color = l.faint) },
        keyboardOptions = KeyboardOptions(
            keyboardType = if (money) KeyboardType.Decimal else KeyboardType.Number,
            imeAction = ImeAction.Done,
        ),
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = l.accent, unfocusedBorderColor = l.border),
        modifier = Modifier
            .width(width.dp)
            .semantics { contentDescription = description }
            .onFocusChanged {
                if (focused && !it.isFocused) onLeave()
                focused = it.isFocused
            },
    )
}

@Composable
private fun Pace(f: AjustesForm, dailyAuto: Long) {
    val dailyBad = "daily" in f.left && badMoney(f.daily)
    Setting("Diário", if (dailyBad) "Use um valor como 177,00" else "Vazio usa a planilha", dailyBad) {
        Field(
            f.daily, { f.daily = it }, { f.left += "daily"; f.now = true },
            placeholder = fromCents(dailyAuto), description = "Diário", money = true, error = dailyBad, width = 150,
        )
    }
    Setting("Cartão principal", "O do ritmo em Hoje") { CardPicker(f) }
    val budgetBad = "budget" in f.left && badMoney(f.budget)
    Setting("Plano por ciclo", if (budgetBad) "Use um valor como 5.000,00" else "Vazio usa diário × dias", budgetBad) {
        Field(
            f.budget, { f.budget = it }, { f.left += "budget"; f.now = true },
            placeholder = "Auto", description = "Plano por ciclo", money = true, error = budgetBad, width = 150,
        )
    }
}

@Composable
private fun CardPicker(f: AjustesForm) {
    val l = LocalLedger.current
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) { Text(f.usual.ifEmpty { "Automático" }, color = l.text) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            (listOf("") + f.cards.map { it.name }).forEach { name ->
                DropdownMenuItem(
                    text = { Text(name.ifEmpty { "Automático" }) },
                    onClick = {
                        open = false
                        f.usual = name
                        f.now = true
                    },
                )
            }
        }
    }
}

@Composable
private fun Cards(f: AjustesForm) {
    val l = LocalLedger.current
    f.cards.forEach { c ->
        val key = "closing-${c.name}"
        val bad = key in f.left && badDay(f.closing[c.name])
        val other = c.name in f.others
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(c.name)
                Text(
                    if (bad) "Dia de 1 a 31" else "Vence dia ${c.dueDay}${if (other) " · De outra pessoa" else ""}",
                    color = if (bad) l.neg else l.faint,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
            Switch(
                checked = other,
                onCheckedChange = { on ->
                    if (on) f.others += c.name else f.others -= c.name
                    f.now = true
                },
                colors = SwitchDefaults.colors(checkedTrackColor = l.accent, checkedThumbColor = l.bg),
                modifier = Modifier.semantics { contentDescription = "${c.name} é de outra pessoa" },
            )
            Spacer(Modifier.width(10.dp))
            Field(
                f.closing[c.name] ?: "", { f.closing[c.name] = it }, { f.left += key; f.now = true },
                placeholder = "≈ ${c.closingDay}", description = "Dia de fechamento do ${c.name}",
                money = false, error = bad, width = 76,
            )
        }
    }
    Text(
        "O botão marca o cartão de outra pessoa, que fica fora do seu ritmo. O número é o dia em que a " +
            "fatura fecha; com ≈ é estimado: confira na fatura e digite o dia certo.",
        color = l.faint,
        style = MaterialTheme.typography.labelMedium,
    )
}
