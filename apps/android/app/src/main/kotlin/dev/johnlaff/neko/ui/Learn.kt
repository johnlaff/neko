package dev.johnlaff.neko.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.edit
import dev.johnlaff.neko.data.ReserveStep
import dev.johnlaff.neko.data.ReserveSteps
import dev.johnlaff.neko.data.SavingStep

/**
 * What Neko teaches, in its own words, word for word with the site (web/learn.ts): one tip per
 * screen the first time it has data, and the full list in Ajustes › Como funciona.
 */
object Learn {
    const val HOJE = "O arco enche com a fatura aberta. O ponto é o ritmo de hoje."
    const val HOJE_MES = "O arco enche com o gasto do mês. O ponto é o previsto até ontem."
    const val HOJE_CARTOES = "O arco é o quanto os cartões e o Pix do mês já ocupam do teto."
    const val FATURAS = "Compra no cartão entra na planilha só uma vez: na fatura, no vencimento."
    const val MES = "O saldo de cada dia vem da planilha. Com o gasto dos dias à frente previsto, ele fica realista."

    /** Hoje's streak, word for word with the site (web/learn.ts HABIT). */
    const val HABIT_RULE = "Conta os dias em que a planilha mudou. Um dia sem lançar não quebra a sequência se você lançar no dia seguinte."

    /** Yesterday went without a change: today's edit is what keeps the run. */
    const val HABIT_AT_RISK = "Lance hoje para continuar"

    /** Today's edit mended yesterday. */
    const val HABIT_MENDED = "Ontem recuperado"

    /** Each day's mark, as TalkBack says it; the legend shows the first three. */
    val HABIT_DAYS = mapOf(
        "edited" to "lançado",
        "rest" to "recuperado",
        "missed" to "sem lançar",
        "today" to "hoje, em aberto",
        "future" to "ainda não chegou",
    )
    private val MILESTONES = mapOf(
        7 to "Uma semana inteira com a planilha em dia.",
        21 to "Três semanas: lançar já faz parte do seu dia.",
        66 to "66 dias é o tempo médio para um hábito se firmar.",
        100 to "Cem dias de planilha em dia.",
        200 to "Duzentos dias: o método virou rotina.",
        365 to "Um ano inteiro de planilha em dia.",
    )

    fun milestone(m: Int) = MILESTONES[m] ?: "$m dias de planilha em dia."

    /** The run in words; while yesterday waits to be mended the sheet is not "em dia", only the run. */
    fun streakLabel(streak: Int, atRisk: Boolean = false) = when (streak) {
        0 -> "Comece hoje"
        else -> "${if (atRisk) "Sequência de" else "Planilha em dia ·"} $streak ${if (streak == 1) "dia" else "dias"}"
    }

    /** Mês's totals, the method's, word for word with the site (web/learn.ts TOTALS). */
    const val SAVED = "Guardado"

    /** The month still has Reserva lines ahead of today. */
    const val TO_SAVE = "A guardar"

    /** "20% a 30%" never breaks across lines. */
    const val SAVE_GOAL = "Meta de 20%\u00A0a\u00A030% das entradas"
    const val DAILY = "Diário médio"
    const val DAILY_CAPTION = "Diário e faturas do mês, por dia"
    const val COST = "Custo de vida"
    const val COST_NOTE =
        "Custo de vida é o que saiu sem contar o que foi guardado. A reserva de emergência do método cobre de 6 a 12 meses desse custo."

    /** The low end of the method's 20–30% kept (engine KEPT_GOAL): the share turns green from it. */
    const val KEPT_GOAL = 20

    /** Under Ver extrato, why a month that kept money can show the balance going down. */
    fun resultNote(down: Boolean) =
        "O saldo ${if (down) "desceu" else "subiu"} é a diferença entre o começo e o fim do mês, e o que foi guardado também sai da conta."

    /** Mês's reserve panel, word for word with the site (web/learn.ts RESERVE). */
    const val RESERVE_TITLE = "Reserva de emergência"
    const val RESERVE_MORE = "Como funciona"
    const val RESERVE_RULE = "O método pede de 6 a 12 meses, guardados onde dá para sacar na hora."
    const val RESERVE_EMPTY = "Para contar aqui, lance o valor como Saída sob o título Reserva, nas notas."
    const val RESERVE_NOTHING = "Nada guardado ainda"
    const val RESERVE_DONE = "Reserva completa"
    const val RESERVE_MINIMUM = "Já tem os 6 meses que o método pede"

    /** A goal's distance in whole reais, rounded up: the goal is a multiple of an average. */
    private fun upToReal(cents: Long) = Format.roundMoney((cents + 99) / 100 * 100)

    private fun months(n: Int) = "$n ${if (n == 1) "mês" else "meses"} de custo de vida"

    /** A step as a goal: "os primeiros R$ 3.000" or "3 meses de custo de vida". */
    fun stepGoal(s: ReserveStep): String = s.months?.let(::months) ?: "os primeiros ${Format.roundMoney(s.amount)}"

    /** Over the meter: which step is being climbed, out of all of them. */
    fun stepsMeta(s: ReserveSteps, kept: Long) = when {
        s.next == null -> RESERVE_DONE
        kept > 0 -> "Degrau ${s.reached + 1} de ${s.steps.size}"
        else -> RESERVE_NOTHING
    }

    /** True once the method's minimum of 6 months is kept: from there on 12 is his call. */
    private fun minimumKept(s: ReserveSteps) = s.steps.getOrNull(s.reached - 1)?.months == 6

    /** Under the meter, in bold: how far the next step is. */
    fun stepLine(s: ReserveSteps, kept: Long): String {
        val next = s.next ?: return "Já passou de ${s.steps.lastOrNull()?.let(::stepGoal) ?: ""}"
        if (minimumKept(s)) return RESERVE_MINIMUM
        if (kept > 0) return "Faltam ${upToReal(s.missing)} para ${stepGoal(next)}"
        return "Primeiro degrau: ${if (next.months == null) Format.roundMoney(next.amount) else stepGoal(next)}"
    }

    /** Under that, muted, when there is one: how to start, or what 12 months would still need. */
    fun stepHint(s: ReserveSteps, kept: Long): String? = when {
        kept <= 0 -> RESERVE_EMPTY
        s.next != null && minimumKept(s) -> "Para 12 meses, faltam ${upToReal(s.missing)}."
        else -> null
    }

    /** The steps in one line, before the method's rule. */
    fun stepsRule(s: ReserveSteps): String {
        val n = s.steps.mapNotNull { it.months }
        val list = "${n.dropLast(1).joinToString(", ")} e ${n.lastOrNull()} meses de custo de vida"
        val first = s.steps.firstOrNull()
        return if (first != null && first.months == null) "Degraus: ${Format.roundMoney(first.amount)}, depois $list."
        else "Degraus: $list."
    }

    /** Hoje's payday card: what saving it all does to the reserve. */
    fun saveStepText(s: SavingStep): String {
        val m = s.step.months
        return when {
            s.missing > 0 -> "Com isso, faltam ${upToReal(s.missing)} para ${stepGoal(s.step)}"
            m == null -> "Com isso, a reserva chega a ${Format.roundMoney(s.step.amount)}"
            m == 6 -> "Com isso, a reserva chega a 6 meses, o mínimo do método"
            else -> "Com isso, a reserva chega a ${months(m)}"
        }
    }

    fun costLabel(months: Int) =
        if (months == 1) "Custo de vida do último mês" else "Custo de vida, média de $months meses"

    data class Idea(val title: String, val body: String)

    /** Opens Ajustes › Como funciona. */
    const val INTRO = "Todas as dicas do app, num lugar só."

    /** Where cards come from, when the sheet has none: Hoje and Faturas say it the same way. */
    const val CARDS_COME_FROM = "Os cartões vêm das notas de Saída, abaixo da linha CARTÕES."

    val IDEAS = listOf(
        Idea("De onde vêm os números", "Tudo vem da sua planilha. O Neko lê e faz as contas, e só escreve nela quando você toca em Lançar."),
        Idea(
            "Saída ou diário",
            "Conta com data e valor certos vai em Saída. O gasto do dia a dia é diário. No cartão, a compra entra só na fatura, no dia do vencimento.",
        ),
        Idea(
            "Os dias à frente",
            "Deixe previsto o gasto de cada dia futuro e troque pelo real quando o dia passar. Sem isso, o saldo de lá parece maior.",
        ),
        Idea("O dia mais baixo", "Olhe o menor saldo daqui para frente. Se ficar abaixo de zero, você já sabe quando e quanto vai faltar."),
        Idea(
            "Guardar primeiro",
            "No dia em que o dinheiro entra, separe o que der. O saldo cai, e tudo bem: mire guardar de 20% a 30% das entradas.",
        ),
        Idea("Reserva", "Antes de investir, junte de 6 a 12 meses do seu custo de vida."),
    )
}

/** Which tips were dismissed on this phone, and the one this visit is spending its single slot on. */
object Hints {
    private const val PREFS = "hints"
    private const val SEEN = "seen"
    private var loaded = false
    private var seen by mutableStateOf(emptySet<String>())
    private var current by mutableStateOf<String?>(null)

    private fun load(context: Context) {
        if (loaded) return
        seen = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(SEEN, emptySet()).orEmpty()
        loaded = true
    }

    internal fun showing(context: Context, id: String): Boolean {
        load(context)
        return id !in seen && (current == null || current == id)
    }

    /** Whether this tip, or a once-only opening like the streak's, was already sent away here. */
    internal fun seen(context: Context, id: String): Boolean {
        load(context)
        return id in seen
    }

    internal fun claim(id: String) {
        if (current == null) current = id
    }

    fun dismiss(context: Context, id: String) {
        seen = seen + id
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit { putStringSet(SEEN, seen) }
    }

    /** Ajustes › Rever dicas: every tip comes back, one per visit as before. */
    fun reset(context: Context) {
        seen = emptySet()
        current = null
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit { remove(SEEN) }
    }
}

/** A one-time tip under the number it explains; "Entendi" sends it away for good. */
@Composable
fun Hint(id: String, text: String) {
    val context = LocalContext.current
    if (!Hints.showing(context, id)) return
    LaunchedEffect(id) { Hints.claim(id) }
    val l = LocalLedger.current
    // Large text: "Entendi" drops under the tip instead of squeezing it into a narrow column.
    val stacked = LocalDensity.current.fontScale >= 1.3f
    Column(
        Modifier
            .fillMaxWidth()
            .background(l.surface2, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TipMark()
            Text(text, color = l.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f).padding(vertical = 8.dp))
            if (!stacked) TextAction("Entendi", { Hints.dismiss(context, id) }, l.text)
        }
        if (stacked) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                TextAction("Entendi", { Hints.dismiss(context, id) }, l.text)
            }
        }
    }
}
