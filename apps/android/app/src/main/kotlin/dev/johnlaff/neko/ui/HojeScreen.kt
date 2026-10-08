package dev.johnlaff.neko.ui

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalDensity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import dev.johnlaff.neko.R
import androidx.compose.ui.res.painterResource
import androidx.compose.material3.Icon
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.semantics.contentDescription
import kotlinx.coroutines.launch
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import dev.johnlaff.neko.data.CanSpend
import dev.johnlaff.neko.data.MissingMovement
import dev.johnlaff.neko.data.MonthRecap
import dev.johnlaff.neko.data.Saving
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.data.MiaStatus
import dev.johnlaff.neko.data.UpcomingDay
import dev.johnlaff.neko.ui.Format.days
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.relativeDay
import dev.johnlaff.neko.ui.Format.shortDate
import dev.johnlaff.neko.ui.Format.signed

@Composable
fun HojeScreen(
    state: TodayState,
    onRefresh: () -> Unit,
    onAjustes: () -> Unit,
    simulate: Simulate? = null,
    simulatorOpen: Boolean = false,
    /** Grows each time the "Simular" shortcut is used: opens the simulator again. */
    simulateAsk: Int = 0,
    mia: MiaStatus? = null,
    askMia: AskMia? = null,
    /** Opens the screen a value of Mia's came from: "hoje", "faturas" or "mes". */
    onScreen: (String) -> Unit = {},
    miaOpen: Boolean = false,
    miaTalk: List<MiaExchange> = emptyList(),
) {
    var simulating by rememberSaveable { mutableStateOf(simulatorOpen) }
    var asking by rememberSaveable { mutableStateOf(miaOpen) }
    LaunchedEffect(simulateAsk) { if (simulateAsk > 0) simulating = true }
    ScreenFrame("Hoje", state, { it.readAt }, onRefresh) { v ->
        item { Hero(v) }
        val cs = v.canSpend.takeIf { simulate != null }
        if (v.todayUrl != null || cs != null) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    v.todayUrl?.let { url -> LancarButton(url, Modifier.weight(1f)) }
                    if (cs != null) SimulateButton(simulating, Modifier.weight(1f)) { simulating = !simulating }
                }
            }
        }
        if (cs != null && simulate != null && simulating) item { Simulator(cs, simulate) }
        if (mia?.ligada == true && askMia != null) {
            item { MiaButton(asking) { asking = !asking } }
            if (asking) item { MiaPanel(mia, askMia, onScreen, miaTalk) }
        }
        v.habit?.let { h -> item { Streak(h) } }
        v.habit?.let { h ->
            when {
                h.milestone != null -> item { MilestoneCard("Marca de ${h.milestone} dias", Learn.milestone(h.milestone), h.milestone) }
                h.record != null -> item {
                    MilestoneCard("Novo recorde", "${h.record + 1} dias seguidos. O anterior era ${h.record}.", h.record + 1)
                }
            }
        }
        if (v.insights.isNotEmpty()) item { Insights(v, onAjustes) }
        v.saving?.let { s -> item { SaveCard(s, v.today) } }
        v.recap?.let { r -> item { RecapPanel(r) { onScreen("mes") } } }
        item { Upcoming(v) }
        item { Conference(v) }
        v.bankMissing?.takeIf { it.isNotEmpty() }?.let { m -> item { BankMissing(m) } }
    }
}

@Composable
private fun Hero(v: TodayView) {
    val l = LocalLedger.current
    val cs = v.canSpend
    if (cs == null) {
        Panel {
            Mascot(Pose.Searching, Modifier.height(96.dp))
            Text("Nenhum cartão na planilha", style = MaterialTheme.typography.headlineSmall)
            Text("O Neko procura faturas nas notas de Saída, debaixo de uma linha CARTÕES.", color = l.muted)
        }
        return
    }
    val over = cs.pace == "over"
    var formula by remember { mutableStateOf(false) }
    Panel {
        // Over the plan, the figure already says so in red: the chip would repeat it.
        PanelHead(cs.card) {
            when (cs.pace) {
                "over" -> Unit
                "on-pace" -> Chip("No ritmo", ChipTone.Ok)
                else -> Chip("Acima do ritmo", ChipTone.Warn)
            }
        }
        // With large text the figure no longer fits inside the arc: it goes under it instead.
        val stacked = LocalDensity.current.fontScale >= 1.25f
        val gauge = @Composable {
            Gauge(
                value = cs.accumulated,
                total = cs.budget,
                mark = cs.paceExpected,
                over = over || cs.paceGap < 0,
                bad = over,
                modifier = Modifier.fillMaxWidth(if (stacked) 0.6f else 0.86f).aspectRatio(2f),
            )
        }
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
            if (!stacked) gauge()
            // Read as one sentence: "Hoje cabem, R$ 147,00, por dia".
            Column(Modifier.semantics(mergeDescendants = true) {}, horizontalAlignment = Alignment.CenterHorizontally) {
                if (stacked) gauge()
                Text(if (over) "Passou do plano" else "Hoje cabem", color = l.muted, style = MaterialTheme.typography.labelMedium)
                BigMoney(if (over) cs.overBy else cs.perDay, if (over) l.neg else l.text)
                Text(
                    when {
                        over -> "neste ciclo"
                        cs.daysLeft == 1 -> "até a fatura fechar, hoje"
                        else -> "por dia"
                    },
                    color = l.muted,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
        if (cs.daysLeft > 1) Chip("Fecha ${shortDate(cs.closing)} · ${days(cs.daysLeft)}", ChipTone.Plain)
        // The toggle and what it opens sit together: closed, the panel spends no gap on it.
        Column(Modifier.semantics { stateDescription = if (formula) "Aberto" else "Fechado" }) {
            TextAction(if (formula) "Esconder a conta" else "Como calculei", { formula = !formula }, open = formula)
            Reveal(formula) { Formula(cs, v) }
        }
        Hint("hoje", Learn.HOJE)
    }
}

@Composable
private fun Formula(cs: CanSpend, v: TodayView) {
    val l = LocalLedger.current
    val budget = if (cs.budgetSource == "diario")
        "de diário no ciclo (${money(v.dailyForecast)} por dia, ${Copy.dailySource(v.dailySource)})"
    else "planejados para o ciclo"
    Text(
        "${money(cs.budget)} $budget menos ${money(cs.accumulated)} na fatura, dividido por ${days(cs.daysLeft)}.",
        color = l.muted,
    )
    Text(
        "O ponto no arco é o ritmo de hoje: a fatura está ${money(kotlin.math.abs(cs.paceGap))} " +
            "${if (cs.paceGap >= 0) "abaixo" else "acima"} dele.",
        color = l.muted,
    )
}

@Composable
private fun LancarButton(url: String, modifier: Modifier = Modifier) {
    val l = LocalLedger.current
    val context = LocalContext.current
    Button(
        onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) },
        modifier = modifier.fillMaxWidth().height(48.dp),
        // The one filled button on the screen, as on the site: logging is the method's daily act.
        colors = ButtonDefaults.buttonColors(containerColor = l.text, contentColor = l.bg),
        shape = RoundedCornerShape(50),
        contentPadding = ButtonDefaults.ButtonWithIconContentPadding,
    ) {
        androidx.compose.material3.Icon(
            androidx.compose.ui.res.painterResource(dev.johnlaff.neko.R.drawable.ic_add),
            contentDescription = null,
            modifier = Modifier.size(ButtonDefaults.IconSize),
        )
        androidx.compose.foundation.layout.Spacer(Modifier.width(ButtonDefaults.IconSpacing))
        Text("Lançar", color = l.bg, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}

@Composable
private fun SimulateButton(open: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val l = LocalLedger.current
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().height(48.dp).semantics { stateDescription = if (open) "Aberto" else "Fechado" },
        colors = ButtonDefaults.outlinedButtonColors(contentColor = l.text),
        border = androidx.compose.foundation.BorderStroke(1.dp, if (open) l.muted else l.border),
        shape = RoundedCornerShape(50),
    ) { Text("Simular compra", style = MaterialTheme.typography.labelLarge, maxLines = 1) }
}

@Composable
private fun Alert(
    title: String,
    detail: String,
    color: androidx.compose.ui.graphics.Color,
    onClick: (() -> Unit)? = null,
    lead: (@Composable () -> Unit)? = null,
    action: (@Composable () -> Unit)? = null,
) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier.fillMaxWidth()
            .appear()
            .semantics(mergeDescendants = true) {}
            // Calm rows: only the dot carries the status color. A celebration (with its cat) keeps
            // a light wash of green, the one alert that is good news rather than a task.
            .then(
                if (lead != null) Modifier.background(color.copy(alpha = 0.10f), shape)
                else Modifier.background(l.surface, shape).border(1.dp, l.border, shape),
            )
            .clip(shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (lead != null) lead()
        else Box(Modifier.size(8.dp).background(color, CircleShape))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(detail, color = l.muted, style = MaterialTheme.typography.bodyMedium)
        }
        action?.invoke()
        if (onClick != null && action == null)
            Icon(painterResource(R.drawable.ic_chevron_right), null, tint = l.faint, modifier = Modifier.size(16.dp))
    }
}

/** A mark or a new best run, the day it lands and the day after (as on the site). */
@Composable
private fun MilestoneCard(title: String, text: String, days: Int) {
    val l = LocalLedger.current
    MilestoneHaptic(days)
    Alert(
        title,
        text,
        l.pos,
        lead = { CelebratingCat(Modifier.height(56.dp).hop()) },
        action = { ShareButton(title, listOf(text), "Compartilhar: $title") },
    )
}

@Composable
private fun Insights(v: TodayView, onAjustes: () -> Unit) {
    val l = LocalLedger.current
    // Two warnings in view, the rest behind one quiet line, most important first (as on the site).
    val known = v.insights.mapNotNull { i -> Copy.insight(i)?.let { i to it } }
    var more by rememberSaveable { mutableStateOf(false) }
    val rest = known.size - ShownAlerts
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        (if (more) known else known.take(ShownAlerts)).forEach { (i, line) ->
            // A guessed closing day is fixed in Ajustes, one tap away.
            val open = if (i.kind == "closing-estimated") onAjustes else null
            // A setup question, not a warning: color stays for real deviations, as on the site.
            val tone = when {
                line.tone == Copy.Tone.Bad -> l.neg
                i.kind == "closing-estimated" -> l.muted
                else -> l.warn
            }
            Alert(line.title, line.detail, tone, open)
        }
        if (rest > 0) {
            TextAction(
                if (more) "Mostrar menos" else if (rest == 1) "Mais 1 aviso" else "Mais $rest avisos",
                { more = !more },
            )
        }
    }
}

private const val ShownAlerts = 2

/** A month's wins in words, next to Neko celebrating: the recap on Hoje and a closed Mês. */
@Composable
internal fun WinsBox(all: List<dev.johnlaff.neko.data.Win>, cat: Dp, title: String) {
    val wins = all.mapNotNull(Copy::win)
    val share = all.mapNotNull(Copy::winShare)
    if (wins.isEmpty()) return
    val l = LocalLedger.current
    Column(
        Modifier.fillMaxWidth()
            .background(l.pos.copy(alpha = 0.10f), RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 6.dp),
    ) {
        Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
            CelebratingCat(Modifier.height(cat).hop())
            Spacer(Modifier.width(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                wins.forEach { Text(it, color = l.text, style = MaterialTheme.typography.titleSmall) }
            }
        }
        // The picture carries the wins only, never an amount (share/WinCard.kt).
        Box(Modifier.align(Alignment.End).padding(bottom = 6.dp)) {
            ShareButton("$title fechou", share, "Compartilhar as conquistas de ${title.lowercase()}")
        }
    }
}

/** Opens the share sheet with an achievement's picture (share/WinCard.kt), one at a time. */
@Composable
private fun ShareButton(title: String, lines: List<String>, label: String) {
    val l = LocalLedger.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    OutlinedButton(
        onClick = {
            busy = true
            scope.launch {
                try {
                    dev.johnlaff.neko.share.WinCard.share(context, title, lines)
                } finally {
                    busy = false
                }
            }
        },
        enabled = !busy,
        modifier = Modifier.heightIn(min = 40.dp).semantics { contentDescription = label },
        colors = ButtonDefaults.outlinedButtonColors(contentColor = l.text),
        border = androidx.compose.foundation.BorderStroke(1.dp, l.muted),
        contentPadding = PaddingValues(horizontal = 14.dp),
    ) { Text("Compartilhar", style = MaterialTheme.typography.labelLarge, maxLines = 1) }
}

/**
 * The month that just closed, as on the site: how it ended, what it kept, what it cost to live
 * and where most of it went. A plain panel: it informs, it does not warn.
 */
@Composable
internal fun RecapPanel(r: MonthRecap, onMonth: () -> Unit = {}) {
    val l = LocalLedger.current
    Panel {
        PanelHead("${Format.capitalize(Format.monthName(r.month))} fechou") {
            TextAction("Ver o mês", onMonth, color = l.accent)
        }
        WinsBox(r.wins, 64.dp, "${Format.capitalize(Format.monthName(r.month))} de ${r.year}")
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            LedgerLine(
                if (r.result < 0) "Faltou" else "Sobrou",
                money(kotlin.math.abs(r.result)),
                when {
                    r.result > 0 -> l.pos
                    r.result < 0 -> l.neg
                    else -> l.text
                },
            )
            if (r.saved > 0) {
                LedgerLine("Guardado" + (r.savedShare?.let { " · $it% das entradas" } ?: ""), money(r.saved))
            }
            // Custo de vida and the largest line are one tap away, on Mês.
        }
    }
}

@Composable
private fun SaveCard(s: Saving, today: String) {
    val l = LocalLedger.current
    val isToday = s.date == today
    Alert(
        if (isToday) "Hoje dá para guardar ${money(s.amount)}" else "${relativeDay(s.date, today)}: guardar ${money(s.amount)}",
        "Mesmo guardando, o dia mais apertado até ${shortDate(s.until)} fica com ${money(s.leftAtLowest)}",
        l.pos,
    )
}

@Composable
private fun Upcoming(v: TodayView) {
    val l = LocalLedger.current
    Panel {
        PanelHead("Próximos 7 dias") {
            if (v.upcomingCount > 0) Text("${v.upcomingCount} itens", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        if (v.upcoming.isEmpty()) Text("Nada lançado para esta semana.", color = l.muted)
        v.upcoming.forEach { Day(it, v.today) }
    }
}

@Composable
private fun Day(d: UpcomingDay, today: String) {
    val l = LocalLedger.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // A band names the day, as on the site; its total only when it adds up more than one line.
        Row(
            Modifier.fillMaxWidth().background(l.surface2, RoundedCornerShape(10.dp)).padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(relativeDay(d.date, today), style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold))
            if (d.items.size > 1) {
                Text(
                    signed(kotlin.math.abs(d.net), if (d.net > 0) '+' else '−'),
                    color = if (d.net > 0) l.pos else l.muted,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
        d.items.forEach { u ->
            val income = u.kind == "income"
            ListRow(
                name = u.description.ifBlank { "Sem descrição" },
                value = signed(u.amount, if (income) '+' else '−'),
                modifier = Modifier.semantics(mergeDescendants = true) {},
                avatar = "",
                avatarIcon = when (u.kind) {
                    "income" -> R.drawable.ic_income
                    "card" -> R.drawable.ic_card
                    else -> R.drawable.ic_receipt
                },
                card = u.description.takeIf { u.kind == "card" },
                valueColor = if (income) l.pos else l.text,
                accent = income,
            )
        }
    }
}

@Composable
private fun Conference(v: TodayView) {
    val l = LocalLedger.current
    val context = LocalContext.current
    Panel {
        PanelHead("Conferência") {
            val n = v.issues.size
            Chip(
                when (n) {
                    0 -> "Tudo certo"
                    1 -> "1 ponto"
                    else -> "$n pontos"
                },
                if (n == 0) ChipTone.Ok else ChipTone.Warn,
            )
        }
        // All clear is the title and its chip alone: a sentence saying so again only adds height.
        v.issues.forEach { t ->
            val line = Copy.issue(t.issue)
            Column(
                Modifier.fillMaxWidth()
                    .clickable(onClickLabel = "abrir na planilha", role = Role.Button) {
                        context.startActivity(Intent(Intent.ACTION_VIEW, t.url.toUri()))
                    }
                    .padding(vertical = 4.dp),
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(line.title, modifier = Modifier.weight(1f))
                    Text(shortDate(t.issue.date), color = l.muted)
                }
                Text(line.detail, color = l.faint, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

/**
 * What moved in the account and has no line in the sheet yet (as on the site). Neko never writes
 * the sheet: a tap copies the line as the day's note wants it, and the owner pastes it there.
 */
@Composable
private fun BankMissing(items: List<MissingMovement>) {
    val l = LocalLedger.current
    val context = LocalContext.current
    var copied by remember { mutableStateOf<Int?>(null) }
    Panel {
        PanelHead("Fora da planilha") {
            Chip(if (items.size == 1) "1 movimento" else "${items.size} movimentos", ChipTone.Warn)
        }
        items.forEachIndexed { i, m ->
            Column(
                Modifier.fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clickable(onClickLabel = "copiar a linha da nota", role = Role.Button) {
                        context.getSystemService(ClipboardManager::class.java)
                            ?.setPrimaryClip(ClipData.newPlainText("Neko", m.line))
                        copied = i
                    }
                    .padding(vertical = 4.dp),
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(Format.bankText(m.description), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        signed(m.amount, if (m.amount > 0) '+' else '−'),
                        color = if (m.amount > 0) l.pos else l.text,
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
                Text(
                    if (copied == i) "Linha copiada. Cole na nota do dia"
                    else "${shortDate(m.date)} · ${if (m.amount > 0) "Entrada" else "Saída"}",
                    color = l.faint,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
        Text(
            "Toque para copiar a linha da nota. O banco não muda a planilha.",
            color = l.muted,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}
