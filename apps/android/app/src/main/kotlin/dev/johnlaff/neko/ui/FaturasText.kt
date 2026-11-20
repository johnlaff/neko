package dev.johnlaff.neko.ui

import dev.johnlaff.neko.data.BankLine
import dev.johnlaff.neko.data.InvoiceRow
import dev.johnlaff.neko.ui.Format.bankText
import dev.johnlaff.neko.ui.Format.capitalize
import dev.johnlaff.neko.ui.Format.monthName
import dev.johnlaff.neko.ui.Format.shortDate
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** Faturas' words, as the site writes them (web/faturas/text.ts). */

/** `2026-11` → `novembro`. */
internal fun monthWord(key: String) = monthName(key.substring(5, 7).toInt())

/** `2026-11` → `Nov`, under a chart's column. */
internal fun shortMonthWord(key: String) = capitalize(monthWord(key).take(3))

/** `2027-06` → `jun/27`, the way a bill says when a plan ends. */
internal fun monthYear(key: String) = "${monthWord(key).take(3)}/${key.substring(2, 4)}"

/** `12/12`, the way a message writes a day. */
internal fun slashDate(iso: String) = "${iso.substring(8, 10)}/${iso.substring(5, 7)}"

/** A purchase's first letter, for its avatar when no category fits: the way banks show a store. */
internal fun initialOf(name: String) = name.firstOrNull { it.isLetterOrDigit() }?.uppercase() ?: ""

internal fun countOf(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"

/** `vence hoje`, `vence amanhã`, `vence 12 nov`. */
internal fun dueText(due: String, today: String) =
    when (ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(due))) {
        0L -> "vence hoje"
        1L -> "vence amanhã"
        else -> "vence ${shortDate(due)}"
    }.replace(' ', ' ') // a wrap falls at the "·", never inside the date

/** Where the bill stands, in one line: the row's only words besides its name. */
internal fun billStateLine(c: InvoiceRow, today: String): String =
    when {
        c.owner != null -> "De ${c.owner} · "
        c.others -> "De outra pessoa · "
        c.reimbursed -> "Reembolsada · "
        else -> ""
    } + billState(c, today)

private fun billState(c: InvoiceRow, today: String): String {
    if (c.state == "due") return "Venceu ${shortDate(c.due)}"
    val due = dueText(c.due, today)
    if (c.state == "closed" || c.bank?.closed == true) return "Fechada · $due"
    if (c.state == "future") return capitalize(due)
    val open = if (c.bank?.onlyParcels == true) "Só parcelas por enquanto"
    else Format.closesIn(c.closesInDays) + if (c.closingEstimated) " (estimado)" else ""
    return "$open · $due"
}

private val WEEKDAYS = listOf("Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo")

/** A purchase's day on its bill: `Hoje`, `Ontem, 19 nov`, `Segunda, 17 nov`. */
internal fun buyDay(date: String, today: String): String {
    val d = LocalDate.parse(date)
    return when (ChronoUnit.DAYS.between(d, LocalDate.parse(today))) {
        0L -> "Hoje"
        1L -> "Ontem, ${shortDate(date)}"
        else -> "${WEEKDAYS[d.dayOfWeek.value - 1]}, ${shortDate(date)}"
    }
}

internal fun isParcel(l: BankLine) = (l.installments ?: 1) > 1

/** `4 de 10 · acaba em jun/27`, or `10 de 10 · última`. */
internal fun parcelLabel(l: BankLine): String? {
    val n = l.installment ?: return null
    val total = l.installments?.takeIf { it > 1 } ?: return null
    val of = "$n de $total"
    if (n >= total) return "$of · última"
    return l.endsIn?.let { "$of · acaba em ${monthYear(it)}" } ?: of
}

/** The bank writes the parcel into the text too ("LOJA PARC 03/06"); the line already says it. */
internal fun bankLineName(l: BankLine) = bankText(
    Format.merchantName(
        if (l.installment == null) l.description
        else l.description.replace(Regex("""\s*(parc(ela)?\.?\s*)?\d{1,2}\s*/\s*\d{1,2}\s*$""", RegexOption.IGNORE_CASE), ""),
    ),
)

/** `junho`, or `junho de 2027` outside today's year. */
internal fun monthLong(key: String, today: String) =
    if (key.take(4) == today.take(4)) monthWord(key) else "${monthWord(key)} de ${key.take(4)}"

/** `2026-11` plus `n` months. */
internal fun monthAfter(key: String, n: Int): String {
    val at = key.take(4).toInt() * 12 + key.substring(5, 7).toInt() - 1 + n
    return "${at / 12}-${(at % 12 + 1).toString().padStart(2, '0')}"
}
