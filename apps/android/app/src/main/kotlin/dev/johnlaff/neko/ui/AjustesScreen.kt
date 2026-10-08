package dev.johnlaff.neko.ui

import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
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
import androidx.compose.material3.SwitchColors
import androidx.compose.material3.SwitchDefaults
import androidx.compose.ui.text.style.TextAlign
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.role
import androidx.compose.foundation.layout.size
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.AjustesView
import dev.johnlaff.neko.data.BankCard
import dev.johnlaff.neko.data.BankItem
import dev.johnlaff.neko.data.BankLink
import dev.johnlaff.neko.data.BanksView
import dev.johnlaff.neko.data.CardConfig
import dev.johnlaff.neko.data.CardDays
import dev.johnlaff.neko.data.Device
import dev.johnlaff.neko.data.UserSettings
import dev.johnlaff.neko.ui.Format.fromCents
import dev.johnlaff.neko.ui.Format.toCents
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.stateDescription
import dev.johnlaff.neko.R
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
    devices: DevicesList = DevicesList(),
    lock: LockSwitch = LockSwitch(),
    banks: BanksList = BanksList(),
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
            // TalkBack says "Salvo" / "Não salvou" without moving focus, as the autosave has no button.
            Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                when (save) {
                    SaveState.Idle -> Unit
                    SaveState.Saving -> Chip("Salvando…", ChipTone.Plain)
                    SaveState.Saved -> Chip("Salvo", ChipTone.Ok)
                    SaveState.Failed -> Chip("Não salvou", ChipTone.Bad)
                }
            }
        },
    ) { view ->
        val f = form ?: return@ScreenFrame
        item { Group("Ritmo") { Pace(f, view.dailyAuto) } }
        if (f.cards.isNotEmpty()) item { Group("Cartões") { Cards(f) } }
        banks.view?.takeIf { it.configured || it.items.isNotEmpty() }?.let { b ->
            item {
                Column {
                Group("Bancos") { Banks(b, f.cards.map { it.name }, banks) }
                Text(
                    "O Neko só lê o banco e nunca muda a planilha. O Item ID está no Dashboard da Pluggy, em Connected Items.",
                    color = LocalLedger.current.faint,
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp),
                )
                }
            }
        }
        item {
            Group("Neste celular") {
                Reminders(reminders)
                Lock(lock)
                if (dev.johnlaff.neko.tile.LancarTile.canAsk) QuickTile()
            }
        }
        devices.list?.takeIf { it.isNotEmpty() }?.let { item { Group("Aparelhos conectados") { Devices(devices) } } }
        item { Group("Como funciona") { HowItWorks() } }
        item {
            Panel {
                ConfirmAction(
                    "Sair deste aparelho",
                    "Sair deste aparelho?",
                    "Para voltar, entre de novo com a passkey.",
                    onLogout,
                )
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
        "Lembretes",
        when {
            r.blocked -> "Permita as notificações do Neko no Android"
            else -> "Às 8h, quanto cabe hoje. Às 21h, lançar o dia"
        },
        r.blocked,
        // The whole row is the switch: a bigger target, and TalkBack reads the label with the state.
        Modifier.toggleable(r.on, role = Role.Switch, onValueChange = toggled(r.onChange)),
    ) {
        Switch(
            checked = r.on,
            onCheckedChange = null,
            colors = switchColors(),
        )
    }
}

/** Offers "Lançar" in Quick Settings; Android shows its own dialog and says if it is already there. */
@Composable
private fun QuickTile() {
    val l = LocalLedger.current
    val context = androidx.compose.ui.platform.LocalContext.current
    Setting(
        "Lançar nas configurações rápidas",
        "Um atalho na barra de notificações",
        modifier = Modifier.clickable(onClickLabel = "adicionar") { dev.johnlaff.neko.tile.LancarTile.ask(context) },
    ) { Text("Adicionar", color = l.accent, style = MaterialTheme.typography.labelLarge) }
}

/** The phone's app lock, also a setting of this device only. */
data class LockSwitch(
    val on: Boolean = false,
    /** Why it can't be turned on here (no screen lock, old Android), or null. */
    val unavailable: String? = null,
    val onChange: (Boolean) -> Unit = {},
)

@Composable
private fun Lock(s: LockSwitch) {
    val l = LocalLedger.current
    Setting(
        "Bloqueio",
        when {
            s.on -> "Pede a digital ao abrir e após 5 min fora"
            s.unavailable != null -> s.unavailable
            else -> "Digital ou senha do celular para abrir"
        },
        modifier = Modifier.toggleable(
            s.on,
            enabled = s.on || s.unavailable == null,
            role = Role.Switch,
            onValueChange = toggled(s.onChange),
        ),
    ) {
        Switch(
            checked = s.on,
            onCheckedChange = null,
            enabled = s.on || s.unavailable == null,
            colors = switchColors(),
        )
    }
}

/** Ajustes › Bancos (specs/003-open-finance); hidden until read and until Pluggy is set up. */
data class BanksList(
    val view: BanksView? = null,
    val onSaveItems: (List<BankLink>) -> Unit = {},
    val onSaveCards: (List<BankCard>) -> Unit = {},
)

private const val MAX_BANKS = 5
private val UUID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

private fun bankStatus(i: BankItem) = when {
    i.error != null -> "Não leu da última vez"
    i.syncedAt != null -> "Lido ${Format.shortDate(i.syncedAt.take(10))}"
    else -> "Ainda não lido"
}

/** The banks linked in Meu Pluggy, when each was read, and which sheet card each bank card is. */
@Composable
private fun Banks(b: BanksView, sheetCards: List<String>, list: BanksList) {
    val l = LocalLedger.current
    val linked = b.items.map { BankLink(it.itemId, it.label) }
    fun tied(accountId: String, number: String?) = b.cards.find { it.accountId == accountId && it.cardNumber == number }?.card ?: ""
    fun tie(accountId: String, number: String?, card: String) = list.onSaveCards(
        b.cards.filterNot { it.accountId == accountId && it.cardNumber == number } +
            (if (card.isEmpty()) emptyList() else listOf(BankCard(accountId, number, card))),
    )
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        b.items.forEach { i ->
            Setting(i.label, bankStatus(i), error = i.error != null) {
                TextButton(
                    onClick = { list.onSaveItems(linked.filterNot { it.itemId == i.itemId }) },
                    modifier = Modifier.semantics { contentDescription = "Desligar ${i.label}" },
                ) { Text("Desligar", color = l.muted) }
            }
            i.accounts.filter { it.card }.forEach { a ->
                // One line for the card account, and one per physical card when it has more.
                (listOf<String?>(null) + if (a.cardNumbers.size > 1) a.cardNumbers else emptyList()).forEach { n ->
                    Setting(
                        if (n != null) "Final $n" else a.name,
                        if (n != null) "Cartão adicional ou titular" else "Cartão na planilha",
                        modifier = Modifier.padding(start = 12.dp),
                    ) {
                        Picker(
                            tied(a.id, n),
                            if (n != null) "Igual ao cartão" else "Não ligar",
                            sheetCards,
                            "Cartão da planilha para ${if (n != null) "o final $n" else a.name}",
                        ) { tie(a.id, n, it) }
                    }
                }
            }
            HorizontalDivider(color = l.border)
        }
        if (b.items.size < MAX_BANKS) {
            var label by rememberSaveable { mutableStateOf("") }
            var itemId by rememberSaveable { mutableStateOf("") }
            val valid = label.isNotBlank() && UUID.matches(itemId.trim())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    label, { label = it.take(40) },
                    placeholder = { Text("Banco") }, singleLine = true,
                    modifier = Modifier.weight(1f).semantics { contentDescription = "Nome do banco" },
                )
                OutlinedTextField(
                    itemId, { itemId = it },
                    placeholder = { Text("Item ID") }, singleLine = true,
                    isError = itemId.isNotBlank() && !UUID.matches(itemId.trim()),
                    modifier = Modifier.weight(1.4f).semantics { contentDescription = "Item ID do Meu Pluggy" },
                )
            }
            TextButton(
                enabled = valid,
                onClick = {
                    list.onSaveItems(linked + BankLink(itemId.trim(), label.trim()))
                    label = ""
                    itemId = ""
                },
            ) { Text("Ligar banco") }
        }
    }
}

/** A dropdown like the usual card's picker, with its own empty choice. */
@Composable
private fun Picker(value: String, empty: String, options: List<String>, description: String, onPick: (String) -> Unit) {
    val l = LocalLedger.current
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(
            onClick = { open = true },
            modifier = Modifier.semantics {
                role = androidx.compose.ui.semantics.Role.DropdownList
                contentDescription = description
            },
        ) {
            Text(value.ifEmpty { empty }, color = l.text)
            Spacer(Modifier.width(4.dp))
            Icon(painterResource(R.drawable.ic_chevron_down), contentDescription = null, tint = l.muted, modifier = Modifier.size(18.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            (listOf("") + options).forEach { name ->
                DropdownMenuItem(
                    text = { Text(name.ifEmpty { empty }) },
                    onClick = {
                        open = false
                        if (name != value) onPick(name)
                    },
                )
            }
        }
    }
}

/** Where Neko is signed in, with a way to sign any other device out; null until read. */
data class DevicesList(
    val list: List<Device>? = null,
    val onEnd: (String) -> Unit = {},
    val onEndOthers: () -> Unit = {},
)

/** "Usado hoje", "Usado ontem", "Usado há 12 dias", from this phone's own clock. */
fun lastUsed(iso: String, now: java.time.LocalDate = java.time.LocalDate.now()): String {
    val day = runCatching { java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault()).toLocalDate() }
        .getOrNull() ?: return "Usado antes"
    val diff = java.time.temporal.ChronoUnit.DAYS.between(day, now)
    return when {
        diff <= 0 -> "Usado hoje"
        diff == 1L -> "Usado ontem"
        else -> "Usado há $diff dias"
    }
}

@Composable
private fun Devices(d: DevicesList) {
    val l = LocalLedger.current
    val list = d.list ?: return
    val others = list.count { !it.current }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        list.forEach { device ->
            Setting(device.device, if (device.current) "Este aparelho" else lastUsed(device.lastSeenAt)) {
                if (!device.current) {
                    TextButton(
                        onClick = { d.onEnd(device.id) },
                        modifier = Modifier.semantics { contentDescription = "Sair do ${device.device}" },
                    ) { Text("Sair", color = l.muted) }
                }
            }
        }
        if (others > 1) {
            ConfirmAction(
                "Sair dos outros $others aparelhos",
                "Sair dos outros $others aparelhos?",
                "Cada um precisará entrar de novo com a passkey. Este continua conectado.",
                d.onEndOthers,
            )
        }
    }
}

/** A switch's change with the system's on/off tick, as Android's own settings do. */
@Composable
private fun toggled(onChange: (Boolean) -> Unit): (Boolean) -> Unit {
    val haptics = LocalHapticFeedback.current
    return { on ->
        haptics.performHapticFeedback(if (on) HapticFeedbackType.ToggleOn else HapticFeedbackType.ToggleOff)
        onChange(on)
    }
}

@Composable
private fun Group(title: String, content: @Composable () -> Unit) {
    val l = LocalLedger.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, color = l.muted, style = MaterialTheme.typography.labelLarge, modifier = Modifier.semantics { heading() })
        Panel { content() }
    }
}

@Composable
private fun Setting(
    label: String,
    sub: String,
    error: Boolean = false,
    modifier: Modifier = Modifier,
    control: @Composable () -> Unit,
) {
    val l = LocalLedger.current
    val words: @Composable () -> Unit = {
        Text(label)
        Text(sub, color = if (error) l.neg else l.faint, style = MaterialTheme.typography.labelMedium)
    }
    // With large text the label and its field no longer fit side by side: the field goes below.
    if (stacked()) {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            words()
            control()
        }
        return
    }
    // A list row's height (56dp), so switch rows breathe like the rows with a field.
    Row(modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { words() }
        Spacer(Modifier.width(12.dp))
        control()
    }
}

@Composable
private fun stacked() = androidx.compose.ui.platform.LocalDensity.current.fontScale >= 1.3f

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
            .then(if (stacked() && money) Modifier.fillMaxWidth() else Modifier.width(width.dp))
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
        TextButton(
            onClick = { open = true },
            modifier = Modifier.semantics { role = androidx.compose.ui.semantics.Role.DropdownList },
        ) {
            Text(f.usual.ifEmpty { "Automático" }, color = l.text)
            Spacer(Modifier.width(4.dp))
            androidx.compose.material3.Icon(
                androidx.compose.ui.res.painterResource(dev.johnlaff.neko.R.drawable.ic_chevron_down),
                contentDescription = null,
                tint = l.muted,
                modifier = Modifier.size(18.dp),
            )
        }
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

/** One switch look on every row, as the site's: off is a small muted thumb on a soft track. */
@Composable
private fun switchColors(): SwitchColors {
    val l = LocalLedger.current
    return SwitchDefaults.colors(
        checkedTrackColor = l.accent,
        checkedThumbColor = l.bg,
        uncheckedTrackColor = l.surface2,
        uncheckedThumbColor = l.muted,
        uncheckedBorderColor = l.faint,
    )
}

/** The switch column is as wide as its header, "Outra pessoa", so both line up. */
private val OTHER_COLUMN = 84.dp
private const val CLOSING_WIDTH = 76

@Composable
private fun Cards(f: AjustesForm) {
    val l = LocalLedger.current
    // Column names over the controls, as on the site; with large text the controls stack and go without.
    if (!stacked()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Cartão", Modifier.weight(1f), color = l.faint, style = MaterialTheme.typography.labelMedium)
            Text("Outra pessoa", Modifier.width(OTHER_COLUMN), color = l.faint, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center)
            Spacer(Modifier.width(10.dp))
            Text("Fecha dia", Modifier.width(CLOSING_WIDTH.dp), color = l.faint, style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center)
        }
    }
    f.cards.forEach { c ->
        val key = "closing-${c.name}"
        val bad = key in f.left && badDay(f.closing[c.name])
        val other = c.name in f.others
        val words: @Composable () -> Unit = {
            Text(c.name)
            Text(
                if (bad) "Dia de 1 a 31" else "Vence dia ${c.dueDay}",
                color = if (bad) l.neg else l.faint,
                style = MaterialTheme.typography.labelMedium,
            )
        }
        val controls: @Composable () -> Unit = {
            Box(Modifier.width(OTHER_COLUMN), contentAlignment = Alignment.Center) {
            Switch(
                checked = other,
                onCheckedChange = toggled { on ->
                    if (on) f.others += c.name else f.others -= c.name
                    f.now = true
                },
                colors = switchColors(),
                modifier = Modifier.semantics { contentDescription = "${c.name} é de outra pessoa" },
            )
            }
            Spacer(Modifier.width(10.dp))
            Field(
                f.closing[c.name] ?: "", { f.closing[c.name] = it }, { f.left += key; f.now = true },
                placeholder = "≈ ${c.closingDay}", description = "Dia de fechamento do ${c.name}",
                money = false, error = bad, width = CLOSING_WIDTH,
            )
        }
        // With large text the name gets the whole width, and its controls go below it.
        if (stacked()) {
            Column(Modifier.fillMaxWidth()) { words() }
            Row(verticalAlignment = Alignment.CenterVertically) { controls() }
        } else {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { words() }
                controls()
            }
        }
    }
    Text(
        // Stacked, the controls have no column names above them, so the sentence says what each one is.
        if (stacked()) {
            "Ligue a chave nos cartões de outra pessoa: eles ficam fora do seu ritmo. O número é o dia em que a " +
                "fatura fecha. Com ≈, é estimado: confira na fatura."
        } else {
            "Cartões de outra pessoa ficam fora do seu ritmo. Dias com ≈ são estimados: confira na fatura."
        },
        color = l.faint,
        style = MaterialTheme.typography.labelMedium,
    )
}

/** A sign-out text action that asks first: undoing it means signing in again on that phone. */
@Composable
private fun ConfirmAction(action: String, question: String, detail: String, onConfirm: () -> Unit) {
    val l = LocalLedger.current
    var asking by remember { mutableStateOf(false) }
    TextAction(action, { asking = true }, l.neg)
    if (asking) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { asking = false },
            title = { Text(question, style = MaterialTheme.typography.headlineSmall) },
            text = { Text(detail, color = l.muted) },
            confirmButton = {
                TextButton(onClick = {
                    asking = false
                    onConfirm()
                }) { Text("Sair", color = l.neg) }
            },
            dismissButton = { TextButton(onClick = { asking = false }) { Text("Cancelar", color = l.text) } },
            containerColor = l.surface,
        )
    }
}

/** Every idea the tips teach, one tap each, for whoever skipped a tip or wants it again. */
@Composable
private fun HowItWorks() {
    val l = LocalLedger.current
    val context = LocalContext.current
    // Mia is the one who gives the tips, so the full list opens with her, book in paw.
    Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Mascot(Pose.MiaTeaching, Modifier.height(72.dp))
        Text(Learn.INTRO, color = l.muted, style = MaterialTheme.typography.bodyMedium)
    }
    Learn.IDEAS.forEach { idea ->
        var open by rememberSaveable(idea.title) { mutableStateOf(false) }
        Column {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable(onClickLabel = if (open) "fechar" else "abrir") { open = !open }
                    .semantics { stateDescription = if (open) "Aberto" else "Fechado" }
                    .heightIn(min = 48.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    painterResource(R.drawable.ic_chevron_right),
                    contentDescription = null,
                    tint = l.faint,
                    modifier = Modifier.size(16.dp).rotate(if (open) 90f else 0f),
                )
                Text(idea.title)
            }
            Reveal(open) {
                Text(idea.body, color = l.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 24.dp, bottom = 8.dp))
            }
        }
    }
    var reset by remember { mutableStateOf(false) }
    HorizontalDivider(color = l.border)
    TextAction(if (reset) "As dicas voltam aos poucos" else "Rever dicas", {
        if (!reset) {
            Hints.reset(context)
            reset = true
        }
    })
}
