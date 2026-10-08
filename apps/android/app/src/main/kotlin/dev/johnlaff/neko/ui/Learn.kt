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

/**
 * What Neko teaches, in its own words, word for word with the site (web/learn.ts): one tip per
 * screen the first time it has data, and the full list in Ajustes › Como funciona.
 */
object Learn {
    const val HOJE = "O arco é a fatura aberta perto do plano do ciclo. Ele muda quando você lança na planilha."
    const val FATURAS = "Compra no cartão entra na planilha uma vez só: na fatura, no dia em que ela vence."
    const val MES = "O saldo de cada dia vem da planilha. Com o gasto dos dias à frente previsto, ele fica realista."

    /** Hoje's streak, word for word with the site (web/learn.ts HABIT). */
    const val HABIT_RULE = "Conta os dias em que a planilha mudou. Uma folga por semana não quebra a sequência."
    private val MILESTONES = mapOf(
        7 to "Uma semana inteira com a planilha em dia.",
        21 to "Três semanas: lançar já faz parte do seu dia.",
        66 to "66 dias é o tempo médio para um hábito se firmar.",
        100 to "Cem dias de planilha em dia.",
        200 to "Duzentos dias: o método virou rotina.",
        365 to "Um ano inteiro de planilha em dia.",
    )

    fun milestone(m: Int) = MILESTONES[m] ?: "$m dias de planilha em dia."

    fun streakLabel(streak: Int) = when (streak) {
        0 -> "Comece hoje"
        1 -> "Planilha em dia · 1 dia"
        else -> "Planilha em dia · $streak dias"
    }

    /** Mês's reserve panel, word for word with the site (web/learn.ts RESERVE). */
    const val RESERVE_TITLE = "Reserva de emergência"
    const val RESERVE_RULE = "O método pede de 6 a 12 meses do custo de vida, guardados onde dá para sacar na hora."
    const val RESERVE_EMPTY = "Só contam como guardado as linhas de Saída sob o título Reserva nas notas."

    /** Tenths of a month as "1,6 mês" or "2 meses". */
    fun coveredLabel(tenths: Int): String {
        val n = if (tenths % 10 == 0) "${tenths / 10}" else "${tenths / 10},${tenths % 10}"
        return "$n ${if (tenths >= 20) "meses" else "mês"}"
    }

    fun costLabel(months: Int) =
        if (months == 1) "Custo de vida do último mês" else "Custo de vida, média de $months meses"

    data class Idea(val title: String, val body: String)

    /** Opens Ajustes › Como funciona, next to Mia. */
    const val INTRO = "Tudo o que a Mia ensina nas dicas, num lugar só."

    val IDEAS = listOf(
        Idea("De onde vêm os números", "Tudo vem da sua planilha. O Neko lê e faz as contas, mas nunca escreve nela."),
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
