package dev.johnlaff.neko.ui

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import dev.johnlaff.neko.BuildConfig
import dev.johnlaff.neko.data.CanSpend
import dev.johnlaff.neko.data.Saving
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.data.UpcomingDay
import dev.johnlaff.neko.ui.Format.days
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.relativeDay
import dev.johnlaff.neko.ui.Format.shortDate
import dev.johnlaff.neko.ui.Format.signed

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HojeScreen(state: TodayState, onRefresh: () -> Unit, onLogout: () -> Unit) {
    val l = LocalLedger.current
    val v = state.view
    PullToRefreshBox(
        isRefreshing = state.loading && v != null,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize().background(l.bg),
    ) {
        LazyColumn(
            Modifier.fillMaxSize().safeDrawingPadding(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { TopBar(v, state, onLogout) }
            when {
                v == null && state.error != null -> item { ErrorPanel(state, onRefresh) }
                v == null -> item { Loading() }
                else -> {
                    item { Hero(v) }
                    v.todayUrl?.let { url -> item { LancarButton(url) } }
                    if (v.insights.isNotEmpty()) item { Insights(v) }
                    v.saving?.let { s -> item { SaveCard(s, v.today) } }
                    item { Upcoming(v) }
                    item { Conference(v) }
                }
            }
        }
    }
}

@Composable
private fun TopBar(v: TodayView?, state: TodayState, onLogout: () -> Unit) {
    val l = LocalLedger.current
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("Hoje", style = MaterialTheme.typography.displayLarge, modifier = Modifier.semantics { heading() })
            val read = when {
                state.error == ReadError.Offline && v != null -> "Sem conexão: mostrando a última leitura"
                v != null && v.readAt.isNotEmpty() -> "Planilha lida ${readAt(v.readAt)}"
                else -> null
            }
            read?.let { Text(it, color = l.faint, style = MaterialTheme.typography.labelMedium) }
        }
        Box {
            TextButton(onClick = { menu = true }) { Text("Mais", color = l.muted) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text("Faturas, mês e ajustes no site") },
                    onClick = {
                        menu = false
                        context.startActivity(Intent(Intent.ACTION_VIEW, BuildConfig.NEKO_URL.toUri()))
                    },
                )
                DropdownMenuItem(text = { Text("Sair") }, onClick = { menu = false; onLogout() })
            }
        }
    }
}

/** `2026-10-05T11:00:00Z` → `5 out, 08:00`, in São Paulo time like the site. */
private fun readAt(iso: String): String = runCatching {
    val t = java.time.Instant.parse(iso).atZone(java.time.ZoneId.of("America/Sao_Paulo"))
    "${shortDate(t.toLocalDate().toString())}, ${"%02d:%02d".format(t.hour, t.minute)}"
}.getOrDefault("")

@Composable
private fun Loading() {
    val l = LocalLedger.current
    Panel { Text("Lendo a planilha…", color = l.muted) }
}

@Composable
private fun ErrorPanel(state: TodayState, onRetry: () -> Unit) {
    val l = LocalLedger.current
    Panel {
        val structure = state.error == ReadError.SheetStructure
        Text(
            if (structure) "A planilha mudou de formato" else "Não consegui ler a planilha",
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            if (structure) "${state.detail ?: ""} O Neko só lê o formato que conhece, então nada foi calculado."
            else "Pode ser a conexão ou o Google fora do ar. A planilha não foi alterada.",
            color = l.muted,
        )
        TextButton(onClick = onRetry, enabled = !state.loading) {
            Text(if (state.loading) "Tentando…" else "Tentar de novo", color = l.accent)
        }
    }
}

@Composable
private fun Hero(v: TodayView) {
    val l = LocalLedger.current
    val cs = v.canSpend
    if (cs == null) {
        Panel {
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
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
            Gauge(
                value = cs.accumulated,
                total = cs.budget,
                mark = cs.paceExpected,
                over = over || cs.paceGap < 0,
                modifier = Modifier.fillMaxWidth(0.86f).aspectRatio(2f),
            )
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
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
            modifier = Modifier.clickable { formula = !formula }.padding(vertical = 4.dp),
        )
        if (formula) Formula(cs, v)
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
private fun LancarButton(url: String) {
    val l = LocalLedger.current
    val context = LocalContext.current
    Button(
        onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) },
        modifier = Modifier.fillMaxWidth().height(48.dp),
        colors = ButtonDefaults.buttonColors(containerColor = l.surface2, contentColor = l.text),
        shape = RoundedCornerShape(14.dp),
    ) { Text("+  Lançar na planilha", style = MaterialTheme.typography.labelLarge) }
}

@Composable
private fun Alert(title: String, detail: String, color: androidx.compose.ui.graphics.Color) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier.fillMaxWidth().background(color.copy(alpha = 0.10f), shape).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).height(36.dp).background(color, RoundedCornerShape(2.dp)))
        Spacer(Modifier.width(12.dp))
        Column {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(detail, color = l.muted, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun Insights(v: TodayView) {
    val l = LocalLedger.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        v.insights.mapNotNull(Copy::insight).forEach { line ->
            Alert(line.title, line.detail, if (line.tone == Copy.Tone.Bad) l.neg else l.warn)
        }
    }
}

@Composable
private fun SaveCard(s: Saving, today: String) {
    val l = LocalLedger.current
    val isToday = s.date == today
    Alert(
        if (isToday) "Dia de guardar ${money(s.amount)}" else "${relativeDay(s.date, today)}: guardar ${money(s.amount)}",
        "${if (isToday) "Entram" else "Vão entrar"} ${money(s.income)}. Guardando, o menor saldo até " +
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
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    u.description.ifBlank { "Sem descrição" },
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
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
                    .clickable { context.startActivity(Intent(Intent.ACTION_VIEW, t.url.toUri())) }
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
