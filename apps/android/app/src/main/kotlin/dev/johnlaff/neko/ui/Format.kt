package dev.johnlaff.neko.ui

import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.abs

/**
 * The site's formatting (apps/neko/src/web/format.ts), so both show the same text: `R$ 1.234,56`
 * with a typographic minus, `13 out`, `Amanhã`. Formatting only: no figure is computed here.
 */
object Format {
    private val MONTHS = listOf(
        "janeiro", "fevereiro", "março", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
    )
    private val WEEKDAYS = listOf("segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo")

    fun money(cents: Long): String {
        val a = abs(cents)
        val reais = (a / 100).toString().reversed().chunked(3).joinToString(".").reversed()
        val sign = if (cents < 0) "−" else ""
        return "${sign}R$\u00A0$reais,${(a % 100).toString().padStart(2, '0')}"
    }

    /** `+R$ 10,00` or `−R$ 10,00`; no sign at zero. */
    fun signed(cents: Long, sign: Char): String = if (cents == 0L) money(0) else "$sign${money(abs(cents))}"

    fun monthName(m: Int): String = MONTHS.getOrElse(m - 1) { "" }

    /** `2026-10-13` → `13 out`. */
    fun shortDate(iso: String): String {
        val d = LocalDate.parse(iso)
        return "${d.dayOfMonth} ${monthName(d.monthValue).take(3)}"
    }

    fun days(n: Int): String = if (n == 1) "1 dia" else "$n dias"

    /** `Hoje`, `Amanhã` or `Quinta, 9 out`, relative to the sheet's today. */
    fun relativeDay(iso: String, today: String): String {
        val diff = ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(iso))
        return when (diff) {
            0L -> "Hoje"
            1L -> "Amanhã"
            else -> {
                val name = WEEKDAYS[LocalDate.parse(iso).dayOfWeek.value - 1]
                "${name.replaceFirstChar { it.uppercase() }}, ${shortDate(iso)}"
            }
        }
    }

    fun capitalize(s: String): String = s.replaceFirstChar { it.uppercase() }

    /** What was typed in a money field, `1.234,56`, as cents; null when empty or not a value. */
    fun toCents(s: String): Long? {
        val t = s.trim().replace(".", "").replace(",", ".")
        if (t.isEmpty()) return null
        val n = t.toBigDecimalOrNull() ?: return null
        if (n.signum() < 0) return null
        return n.movePointRight(2).setScale(0, java.math.RoundingMode.HALF_UP).toLong()
    }

    /** Cents back into a field, `177,00`; empty for none. */
    fun fromCents(c: Long?): String = c?.let { "${it / 100},${(it % 100).toString().padStart(2, '0')}" } ?: ""
}
