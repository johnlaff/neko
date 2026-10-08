package dev.johnlaff.neko.ui

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.LocalDensity
import android.content.Intent
import androidx.compose.foundation.background
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import dev.johnlaff.neko.data.CanSpend
import dev.johnlaff.neko.data.MonthRecap
import dev.johnlaff.neko.data.Saving
import dev.johnlaff.neko.data.TodayView
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
) {
    var simulating by rememberSaveable { mutableStateOf(simulatorOpen) }
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
        v.habit?.let { h -> item { Streak(h) } }
        v.habit?.milestone?.let { m -> item { MilestoneCard(m) } }
        if (v.insights.isNotEmpty()) item { Insights(v, onAjustes) }
        v.saving?.let { s -> item { SaveCard(s, v.today) } }
        v.recap?.let { r -> item { RecapPanel(r) } }
        item { Upcoming(v) }
        item { Conference(v) }
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
        PanelHead(cs.card) {
            when (cs.pace) {
                "over" -> Chip("Acima do plano", ChipTone.Bad)
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
                        over -> "no ciclo"
                        cs.daysLeft == 1 -> "até a fatura fechar, hoje"
                        else -> "por dia"
                    },
                    color = l.muted,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
        if (cs.daysLeft > 1) Chip("Fecha ${shortDate(cs.closing)} · ${days(cs.daysLeft)}", ChipTone.Plain)
        Text(
            if (formula) "Esconder a conta" else "Como calculei",
            color = l.muted,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier
                .clickable(onClickLabel = if (formula) "esconder a conta" else "mostrar a conta") { formula = !formula }
                .semantics { stateDescription = if (formula) "Aberto" else "Fechado" }
                .heightIn(min = 48.dp)
                .wrapContentHeight(),
        )
        Reveal(formula) { Formula(cs, v) }
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
        colors = ButtonDefaults.buttonColors(containerColor = l.surface2, contentColor = l.text),
        shape = RoundedCornerShape(14.dp),
        contentPadding = ButtonDefaults.ButtonWithIconContentPadding,
    ) {
        androidx.compose.material3.Icon(
            androidx.compose.ui.res.painterResource(dev.johnlaff.neko.R.drawable.ic_add),
            contentDescription = null,
            modifier = Modifier.size(ButtonDefaults.IconSize),
        )
        androidx.compose.foundation.layout.Spacer(Modifier.width(ButtonDefaults.IconSpacing))
        Text("Lançar", style = MaterialTheme.typography.labelLarge, maxLines = 1)
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
        shape = RoundedCornerShape(14.dp),
    ) { Text("Simular compra", style = MaterialTheme.typography.labelLarge, maxLines = 1) }
}

@Composable
private fun Alert(
    title: String,
    detail: String,
    color: androidx.compose.ui.graphics.Color,
    onClick: (() -> Unit)? = null,
    lead: (@Composable () -> Unit)? = null,
) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier.fillMaxWidth()
            .appear()
            .semantics(mergeDescendants = true) {}
            .background(color.copy(alpha = 0.10f), shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (lead != null) lead()
        else Box(Modifier.width(4.dp).height(36.dp).background(color, RoundedCornerShape(2.dp)))
        Spacer(Modifier.width(12.dp))
        Column {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(detail, color = l.muted, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun MilestoneCard(m: Int) {
    val l = LocalLedger.current
    MilestoneHaptic(m)
    Alert("Marca de $m dias", Learn.milestone(m), l.pos) {
        CelebratingCat(Modifier.height(56.dp).hop())
    }
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
internal fun WinsBox(wins: List<String>, cat: Dp, title: String) {
    if (wins.isEmpty()) return
    val l = LocalLedger.current
    val context = LocalContext.current
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
        OutlinedButton(
            onClick = { dev.johnlaff.neko.share.WinCard.share(context, title, wins) },
            modifier = Modifier.align(Alignment.End).padding(bottom = 6.dp).heightIn(min = 40.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = l.text),
            border = androidx.compose.foundation.BorderStroke(1.dp, l.muted),
            contentPadding = PaddingValues(horizontal = 14.dp),
        ) { Text("Compartilhar", style = MaterialTheme.typography.labelLarge) }
    }
}

/**
 * The month that just closed, as on the site: how it ended, what it kept, what it cost to live
 * and where most of it went. A plain panel: it informs, it does not warn.
 */
@Composable
internal fun RecapPanel(r: MonthRecap) {
    val l = LocalLedger.current
    val before = Format.monthName(if (r.month == 1) 12 else r.month - 1)
    Panel {
        PanelHead("${Format.capitalize(Format.monthName(r.month))} fechou")
        WinsBox(r.wins.mapNotNull(Copy::win), 64.dp, "${Format.capitalize(Format.monthName(r.month))} de ${r.year}")
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
            LedgerLine("Custo de vida", money(r.livingCost))
            r.costChange?.takeIf { it != 0L }?.let { c ->
                Text(
                    "${if (c < 0) "▼" else "▲"} ${money(kotlin.math.abs(c))} sobre $before",
                    color = if (c < 0) l.pos else l.muted,
                    style = MaterialTheme.typography.labelMedium,
                    textAlign = androidx.compose.ui.text.style.TextAlign.End,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            r.top?.let { t -> LedgerLine("Maior saída", "${t.label} · ${money(t.amount)}") }
        }
    }
}

@Composable
private fun SaveCard(s: Saving, today: String) {
    val l = LocalLedger.current
    val isToday = s.date == today
    Alert(
        if (isToday) "Hoje dá para guardar ${money(s.amount)}" else "${relativeDay(s.date, today)}: guardar ${money(s.amount)}",
        "${if (isToday) "Entram" else "Vão entrar"} ${money(s.income)}. Se guardar, o menor saldo até " +
            "${shortDate(s.until)} fica em ${money(s.leftAtLowest)}",
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
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(relativeDay(d.date, today), color = l.muted, style = MaterialTheme.typography.labelLarge)
            Text(
                signed(kotlin.math.abs(d.net), if (d.net > 0) '+' else '−'),
                color = if (d.net > 0) l.pos else l.muted,
                style = MaterialTheme.typography.labelLarge,
            )
        }
        d.items.forEach { u ->
            val income = u.kind == "income"
            Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
                Text(
                    u.description.ifBlank { "Sem descrição" },
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(signed(u.amount, if (income) '+' else '−'), color = if (income) l.pos else l.text)
            }
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
        if (v.issues.isEmpty()) {
            Text(
                if (v.issuesInWindow == 0) "A planilha confere nos últimos 60 dias."
                else "Nada novo. Os pontos que você já conferiu ficam escondidos.",
                color = l.muted,
            )
        }
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
