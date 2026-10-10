package dev.johnlaff.neko.ui

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalDensity
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.IntrinsicSize
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import kotlinx.coroutines.launch
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import dev.johnlaff.neko.data.CanSpend
import dev.johnlaff.neko.data.HealthIssue
import dev.johnlaff.neko.data.Insight
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
    /** Opens Mia's own screen; null hides the row. */
    onMia: (() -> Unit)? = null,
    /** A conversation waits on Mia's screen: the row offers to continue it. */
    miaTalking: Boolean = false,
    /** Opens another screen: "hoje", "faturas" or "mes". */
    onScreen: (String) -> Unit = {},
    /** Opens Mês on a month ("2025-10"), or on the current one for null, as the site's alerts do. */
    onMonth: (String?) -> Unit = { onScreen("mes") },
    review: Review? = null,
    launcher: Launcher? = null,
    /** Opens Lançar à mão, as the "Lançar" shortcut and the prints do. */
    launchOpen: Boolean = false,
) {
    var simulating by rememberSaveable { mutableStateOf(simulatorOpen) }
    var launching by rememberSaveable { mutableStateOf(launchOpen) }
    var undo by remember { mutableStateOf<String?>(null) }
    var undoText by remember { mutableStateOf("Lançado na planilha") }
    Box(Modifier.fillMaxSize()) {
    LaunchedEffect(simulateAsk) { if (simulateAsk > 0) simulating = true }
    ScreenFrame("Hoje", state, { it.readAt }, onRefresh, miaTopic = "hoje") { v ->
        item { Hero(v) }
        val cs = v.canSpend.takeIf { simulate != null }
        // Writing on, Lançar opens the form here; off, it opens today's row in the sheet.
        val writes = v.writing && launcher != null
        if (v.todayUrl != null || cs != null || writes) {
            item {
                // Both buttons take the taller one's height when large text wraps a label.
                Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (writes) LancarButton(Modifier.weight(1f), launching) { launching = !launching }
                    else v.todayUrl?.let { url -> LancarButton(url, Modifier.weight(1f)) }
                    if (cs != null) SimulateButton(simulating, Modifier.weight(1f)) { simulating = !simulating }
                }
            }
        }
        if (writes && launching && launcher != null) item {
            Panel {
                EntryForm(launcher, v.today, { launching = false }, { undoText = "Lançado na planilha"; undo = it }, cards = v.entryCards)
            }
        }
        if (cs != null && simulate != null && simulating) item { Simulator(cs, simulate) }
        if (mia?.ligada == true && onMia != null) item { MiaButton(miaTalking, onMia) }
        v.habit?.let { h -> item { Streak(h) } }
        if (v.previsto?.review != null && v.previsto.on) item { PrevistoReview(v.previsto, launcher) { undoText = "Diário previsto: ${money(v.previsto?.review?.real ?: 0L)} por dia"; undo = it } }
        // Over the plan, the red figure already says the bill is high: no second card (as on the site).
        val over = (v.canSpend?.perDay ?: 0) < 0
        val insights = v.insights.filter { !(over && it.kind == "bill-above-average") }
        if (insights.isNotEmpty()) item { Insights(insights, onAjustes, { onScreen("faturas") }, onMonth) }
        v.saving?.let { s -> item { SaveCard(s, v.today) } }
        v.recap?.let { r -> item { RecapPanel(r) { onScreen("mes") } } }
        item { Upcoming(v) }
        if (v.queue != null) item { ParaLancar(v, launcher) { undoText = if (it.startsWith(IGNORED)) "Ignorado. Não aparece mais." else "Lançado na planilha"; undo = it } }
        item { Conference(v, review) }
    }
    UndoBar(
        undo, launcher, { undo = null },
        Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(start = 16.dp, end = 16.dp, bottom = 84.dp),
        done = undoText,
    )
    }
}

@Composable
private fun Hero(v: TodayView) {
    val l = LocalLedger.current
    val cs = v.canSpend
    if (cs == null) {
        Panel {
            QuietMark(64.dp)
            Text("Nenhum cartão na planilha", style = MaterialTheme.typography.headlineSmall)
            Text(Learn.CARDS_COME_FROM, color = l.muted)
        }
        return
    }
    val over = cs.pace == "over"
    // With the Diário previsto on, the dial is the month's: cards and Pix against the Diário.
    val month = cs.mode == "month"
    var formula by remember { mutableStateOf(false) }
    Panel {
        // Over the plan, the figure already says so in red: the chip would repeat it.
        PanelHead(if (month) "Diário de ${Format.monthName(v.today.substring(5, 7).toInt())}" else cs.card) {
            // Behind the Diário, the line under the figure already says by how much.
            when {
                cs.pace == "over" || (month && cs.daysBehind > 0) -> Unit
                cs.pace == "on-pace" -> Chip("No ritmo", ChipTone.Ok)
                else -> Chip(if (month) "Acima do previsto" else "Acima do ritmo", ChipTone.Warn)
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
                        over -> if (month) "neste mês" else "neste ciclo"
                        cs.daysLeft == 1 -> if (month) "até o mês acabar, hoje" else "até a fatura fechar, hoje"
                        else -> "por dia"
                    },
                    color = l.muted,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
        // How far ahead of the Diário the month went, in days without spending.
        if (month && cs.daysBehind > 0 && !over)
            Text(
                "${money(-cs.paceGap)} acima do previsto. Uns ${days(cs.daysBehind)} sem gastar e você volta ao previsto.",
                Modifier.fillMaxWidth(),
                color = l.warn,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
        if (cs.daysLeft > 1) Chip("${if (month) "Até" else "Fecha"} ${shortDate(cs.closing)} · ${days(cs.daysLeft)}", ChipTone.Plain)
        // The toggle and what it opens sit together: closed, the panel spends no gap on it.
        Column(Modifier.semantics { stateDescription = if (formula) "Aberto" else "Fechado" }) {
            TextAction(if (formula) "Esconder a conta" else "Como calculei", { formula = !formula }, open = formula)
            Reveal(formula) { Formula(cs, v) }
        }
        Hint("hoje", if (month) Learn.HOJE_MES else Learn.HOJE)
    }
}

@Composable
private fun Formula(cs: CanSpend, v: TodayView) {
    val l = LocalLedger.current
    if (cs.mode == "month") {
        Text(
            "${money(cs.budget)} de Diário previsto no mês (${money(v.dailyForecast)} por dia) menos ${money(cs.accumulated)} " +
                "gastos até ontem nos seus cartões e no Pix, como o banco mostra, dividido por ${days(cs.daysLeft)}.",
            color = l.muted,
        )
        Text(
            "O ponto no arco é o previsto até ontem: o mês está ${money(kotlin.math.abs(cs.paceGap))} " +
                "${if (cs.paceGap >= 0) "abaixo" else "acima"} dele.",
            color = l.muted,
        )
        return
    }
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
    val context = LocalContext.current
    LancarButton(modifier) { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }
}

@Composable
private fun LancarButton(modifier: Modifier = Modifier, open: Boolean? = null, onClick: () -> Unit) {
    val l = LocalLedger.current
    Button(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().fillMaxHeight().heightIn(min = 48.dp)
            .then(if (open != null) Modifier.semantics { stateDescription = if (open) "Aberto" else "Fechado" } else Modifier),
        // The one filled button on the screen, as on the site: logging is the method's daily act.
        colors = ButtonDefaults.buttonColors(containerColor = l.text, contentColor = l.bg),
        shape = RoundedCornerShape(10.dp),
        contentPadding = ButtonDefaults.ButtonWithIconContentPadding,
    ) {
        androidx.compose.material3.Icon(
            androidx.compose.ui.res.painterResource(dev.johnlaff.neko.R.drawable.ic_add),
            contentDescription = null,
            modifier = Modifier.size(ButtonDefaults.IconSize),
        )
        androidx.compose.foundation.layout.Spacer(Modifier.width(ButtonDefaults.IconSpacing))
        Text("Lançar", color = l.bg, style = MaterialTheme.typography.labelLarge, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}

@Composable
private fun SimulateButton(open: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val l = LocalLedger.current
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().fillMaxHeight().heightIn(min = 48.dp).semantics { stateDescription = if (open) "Aberto" else "Fechado" },
        colors = ButtonDefaults.outlinedButtonColors(contentColor = l.text),
        border = androidx.compose.foundation.BorderStroke(1.dp, if (open) l.muted else l.border),
        shape = RoundedCornerShape(10.dp),
    ) { Text("Simular compra", style = MaterialTheme.typography.labelLarge, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center) }
}

@Composable
private fun Alert(
    title: String,
    detail: String,
    color: androidx.compose.ui.graphics.Color,
    onClick: (() -> Unit)? = null,
) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier.fillMaxWidth()
            .appear()
            .semantics(mergeDescendants = true) {}
            // Calm rows: only the dot carries the status color.
            .background(l.surface, shape)
            .border(1.dp, l.border, shape)
            .clip(shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).background(color, CircleShape))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(detail, color = l.muted, style = MaterialTheme.typography.bodyMedium)
        }
        if (onClick != null)
            Icon(painterResource(R.drawable.ic_chevron_right), null, tint = l.faint, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun Insights(
    insights: List<Insight>,
    onAjustes: () -> Unit,
    onFaturas: () -> Unit,
    onMonth: (String?) -> Unit,
) {
    val l = LocalLedger.current
    // Two warnings in view, the rest behind one quiet line, most important first (as on the site).
    val known = insights.mapNotNull { i -> Copy.insight(i)?.let { i to it } }
    var more by rememberSaveable { mutableStateOf(false) }
    val rest = known.size - ShownAlerts
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        (if (more) known else known.take(ShownAlerts)).forEach { (i, line) ->
            // Each warning opens where to look next, as on the site; a guessed closing day is fixed in Ajustes.
            val open: () -> Unit = when (i.kind) {
                "closing-estimated" -> onAjustes
                "bill-above-average" -> onFaturas
                "goes-negative" -> { { onMonth(i.start?.take(7)) } }
                "no-spending-ahead" -> { { onMonth(if (i.year != null && i.month != null) "${i.year}-${i.month.toString().padStart(2, '0')}" else null) } }
                else -> { { onMonth(null) } }
            }
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

/** A month's wins in words: the recap on Hoje and a closed Mês. */
@Composable
internal fun WinsBox(all: List<dev.johnlaff.neko.data.Win>, title: String) {
    val wins = all.mapNotNull(Copy::win)
    val share = all.mapNotNull(Copy::winShare)
    if (wins.isEmpty()) return
    val l = LocalLedger.current
    Column(
        Modifier.fillMaxWidth()
            .background(l.pos.copy(alpha = 0.10f), RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 6.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(top = 8.dp).semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            wins.forEach { Text(it, color = l.text, style = MaterialTheme.typography.titleSmall) }
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
        WinsBox(r.wins, "${Format.capitalize(Format.monthName(r.month))} de ${r.year}")
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
        if (isToday) "Na conta, dá para guardar ${money(s.amount)} hoje"
        else "${relativeDay(s.date, today)}: dá para guardar ${money(s.amount)}",
        "Depois de guardar, menor saldo até ${shortDate(s.until)}: ${money(s.leftAtLowest)}",
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
        if (v.upcoming.isEmpty()) Text("Nada lançado nos próximos 7 dias.", color = l.muted)
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
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // The day name wraps first; the total keeps its figure on one line.
            Text(
                relativeDay(d.date, today),
                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                modifier = Modifier.weight(1f),
            )
            if (d.items.size > 1) {
                Text(
                    signed(kotlin.math.abs(d.net), if (d.net > 0) '+' else '−'),
                    color = if (d.net > 0) l.pos else l.muted,
                    style = MaterialTheme.typography.labelLarge,
                    softWrap = false,
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
                // What the line is about, when its words say so (as on the site); a card keeps its mark.
                avatarVector = if (u.kind == "card") null else categoryIcon(u.description),
                card = u.description.takeIf { u.kind == "card" },
                valueColor = if (income) l.pos else l.text,
                accent = income,
            )
        }
    }
}

/** Sets Conferência points aside (hide) or brings them back; true once the settings saved. */
typealias Review = suspend (keys: List<String>, hide: Boolean) -> Boolean

/** A point's stable name, kept in settings once checked (shared/today.ts `issueKey`). */
private fun issueKey(i: HealthIssue) = "${i.kind}|${i.date}|${i.ref.tab}!${i.ref.a1}"

/**
 * Sheet points the method says should hold but do not. Ones already checked can be set aside, so
 * an old difference nobody will fix does not keep the panel yellow; a new one shows up again.
 */
@Composable
private fun Conference(v: TodayView, review: Review?) {
    val l = LocalLedger.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    // What the last tap hid, so it can come back with one more tap.
    var justHid by rememberSaveable { mutableStateOf<List<String>?>(null) }
    // Which save is on its way (hide or undo), so the button says so; and whether the last one failed.
    var busy by remember { mutableStateOf<Boolean?>(null) }
    var failed by remember { mutableStateOf(false) }
    // Points brought back (Ajustes › Como funciona) come in a newer Hoje: the last hide is then over.
    var seen by remember { mutableStateOf(v.issues) }
    LaunchedEffect(v.issues) {
        if (v.issues != seen) {
            seen = v.issues
            if (v.issues.any { issueKey(it.issue) in justHid.orEmpty() }) justHid = null
        }
    }
    // The Worker leaves checked points out; until Hoje is read again, the ones just hidden stay out here.
    val open = v.issues.filter { issueKey(it.issue) !in justHid.orEmpty() }
    Panel {
        PanelHead("Conferência") {
            val n = open.size
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
        open.forEach { t ->
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
        if (review != null && open.isNotEmpty()) {
            TextAction(
                when {
                    busy == true -> "Escondendo…"
                    open.size == 1 -> "Já conferi, esconder este"
                    else -> "Já conferi, esconder os ${open.size}"
                },
                {
                    if (busy == null) {
                        val keys = open.map { issueKey(it.issue) }
                        busy = true
                        scope.launch {
                            failed = !review(keys, true)
                            if (!failed) justHid = keys
                            busy = null
                        }
                    }
                },
                l.accent,
            )
        }
        val hid = justHid
        if (review != null && open.isEmpty() && hid != null) {
            Row(
                Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    if (hid.size == 1) "1 ponto escondido." else "${hid.size} pontos escondidos.",
                    color = l.muted,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f, fill = false),
                )
                TextAction(if (busy == false) "Desfazendo…" else "Desfazer", {
                    if (busy == null) {
                        busy = false
                        scope.launch {
                            failed = !review(hid, false)
                            if (!failed) justHid = null
                            busy = null
                        }
                    }
                }, l.accent)
            }
        }
        if (failed) SaveFailed()
    }
}
