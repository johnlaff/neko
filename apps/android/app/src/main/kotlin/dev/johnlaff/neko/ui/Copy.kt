package dev.johnlaff.neko.ui

import dev.johnlaff.neko.data.HealthIssue
import dev.johnlaff.neko.data.Insight
import dev.johnlaff.neko.data.Win
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.monthName
import dev.johnlaff.neko.ui.Format.shortDate

/** The site's wording for warnings and Conferência points (screens/Hoje.tsx), word for word. */
object Copy {
    enum class Tone { Bad, Warn }

    data class Line(val title: String, val detail: String, val tone: Tone = Tone.Warn)

    /** A month's win in the recap; null for a kind this version does not know yet. */
    fun win(w: Win): String? = when (w.kind) {
        "blue" -> w.months?.let { if (it == 1) "Mês no azul" else "$it meses seguidos no azul" }
        "kept" -> "Bateu a meta de guardar 20% das entradas"
        "cards-down" -> "Faturas do cartão menores que as do mês anterior"
        "record" -> w.share?.let { "Recorde: guardou $it% das entradas, o maior até aqui" }
        "reserve" -> w.months?.let { "A reserva já cobre ${if (it == 1) "1 mês" else "$it meses"} de custo de vida" }
        else -> null
    }

    /** A win as the shared picture says it: no share of the income kept (shared/wins.ts winShareText). */
    fun winShare(w: Win): String? =
        if (w.kind == "record") "Recorde: o mês que mais guardou até aqui" else win(w)

    /** Null for a kind this version does not know yet: it is skipped, not guessed. */
    fun insight(i: Insight): Line? = when (i.kind) {
        "goes-negative" -> Line(
            if (i.already == true) "Saldo negativo agora" else "Saldo negativo a partir de ${shortDate(i.start ?: return null)}",
            if (i.already == true && i.until != null) {
                "Positivo de novo em ${shortDate(i.until)}. No pior dia, faltam ${money(-(i.deepest ?: 0))}"
            } else {
                "No pior dia, ${shortDate(i.deepestDate ?: return null)}, faltam ${money(-(i.deepest ?: 0))}"
            },
            Tone.Bad,
        )
        "no-spending-ahead" -> Line(
            "${capitalize(monthName(i.month ?: return null))} ainda sem gastos previstos",
            "Sem diário nem fatura lançados, esse saldo ainda está alto",
        )
        "bill-above-average" -> Line("Fatura acima do normal", "${i.card}: ${money(i.over ?: 0)} acima da média")
        "fixed-up" -> Line(
            "${capitalize(i.label ?: return null)} subiu",
            "${money(i.amount ?: 0)} este mês, ${money(i.change ?: 0)} a mais",
        )
        "closing-estimated" -> Line(
            "Qual dia fecha o ${i.card}?",
            "Estimado em ${shortDate(i.closing ?: return null)}. Confirme em Ajustes",
        )
        else -> null
    }

    private fun column(c: String?) = when (c) {
        "entrada" -> "Entrada"
        "saida" -> "Saída"
        "diario" -> "Diário"
        else -> "Célula"
    }

    fun issue(i: HealthIssue): Line = when (i.kind) {
        "missing-date" -> Line("Data vazia", "A linha não tem data na planilha")
        "note-mismatch" -> Line(
            "${column(i.column)} não bate com a nota",
            "Nota ${money(i.notes ?: 0)} · Célula ${money(i.cell ?: 0)}",
        )
        "balance-mismatch" -> Line(
            "Saldo não bate",
            "Planilha ${money(i.sheet ?: 0)} · Pela soma ${money(i.computed ?: 0)}",
        )
        "missing-bill" -> Line("Fatura ${i.card} não lançada", "Venceu e não tem linha na nota de Saída")
        "unparsed-note" -> Line("${column(i.column)}: nota não entendida", "\"${i.lines.firstOrNull() ?: ""}\"")
        else -> Line("Ponto a conferir", "Abra a célula na planilha")
    }

    fun dailySource(source: String) = when (source) {
        "settings" -> "seu ajuste"
        "sheet-note" -> "da nota na planilha"
        else -> "média dos últimos 3 meses"
    }
}
