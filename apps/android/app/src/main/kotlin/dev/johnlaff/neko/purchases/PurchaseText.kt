package dev.johnlaff.neko.purchases

/**
 * A card purchase read from a bank app's notification (specs/002, "Compras na hora"). Pure, so it
 * is tested without a phone. Only an approved purchase in reais, paid at once, is taken: a notice
 * that speaks of Pix, debit, a refusal, a refund or installments is left alone, as is any notice
 * from an app not listed here. The bank brings the same charge later; this only moves the ceiling
 * sooner (worker/phone.ts).
 */
object PurchaseText {
    /**
     * The bank apps read, by package, with the bank's name as its link in Ajustes › Bancos carries
     * it (worker/phone.ts PHONE_BANKS). Cards outside Open Finance are left out: the bank would
     * never bring their charge, and the phone's line would count twice next to the e-mailed bill.
     */
    val BANKS = mapOf(
        "com.bradesco" to "Bradesco",
        "br.com.bradesco.cartoes" to "Bradesco",
        "com.itau" to "Itaú",
        "com.itaucard.activity" to "Itaú",
        "br.com.intermedium" to "Inter",
        "com.mercadopago.wallet" to "Mercado Pago",
    )

    /** What leaves the phone: no other word of the notice. */
    data class Read(val bank: String, val amount: Long, val last4: String?, val merchant: String)

    private val I = RegexOption.IGNORE_CASE
    private val SAID = Regex("""\bcompr(a|ou)\b""", I)
    private val APPROVED = Regex("""aprovad|realizad|efetuad|\bcomprou\b""", I)
    private val NOT = Regex(
        """\bpix\b|d[ée]bito|negad|recusad|n[ãa]o\s+(foi\s+)?aprovad|estorn|cancelad|bloquead|""" +
            """contesta|boleto|transfer|saque|parcel|\b\d{1,2}\s?x\b|\bvezes\b|US\$|U\$|€""",
        I,
    )
    private val AMOUNT = Regex("""R\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?""")
    private val LIMIT = Regex("""limite|saldo|dispon""", I)
    private val LAST4 = Regex("""(?:final|terminad[oa] em|t[ée]rmino)\s*:?\s*(\d{4})\b|[*•]{2,}\s?(\d{4})\b""", I)
    /** Where a shop's name stops: a comma, a full stop, or the words that follow it in a notice. */
    private const val END = """(?=\s*(?:[,;!]|\.(?:\s|$)|\s-\s|$)|\s(?:no|na|com|para|foi|às|as|valor|em)\s|\sde\sR\$)"""
    private val LOCAL = Regex("""\blocal\s*:\s*(.+?)$END""", I)
    private val AT = Regex("""\s(?:em|no estabelecimento|na loja)\s+(?!\d)(?!(?:seu|sua|cart)\w*)(.+?)$END""", I)

    /** The purchase in a notice of [pkg], or null when it is not one this reader trusts. */
    fun read(pkg: String, title: String?, text: String?): Read? {
        val bank = BANKS[pkg] ?: return null
        val all = listOfNotNull(title, text).joinToString(". ").replace(Regex("""\s+"""), " ").trim()
        if (!SAID.containsMatchIn(all) || !APPROVED.containsMatchIn(all) || NOT.containsMatchIn(all)) return null
        // The purchase's amount, not the limit or balance some banks add after it.
        val amount = AMOUNT.findAll(all)
            .firstOrNull { m -> !LIMIT.containsMatchIn(all.substring(maxOf(0, m.range.first - 25), m.range.first)) }
            ?.let { m -> m.groupValues[1].replace(".", "").toLong() * 100 + (m.groupValues[2].ifEmpty { "0" }).toLong() }
            ?.takeIf { it in 1..MAX_CENTS }
            ?: return null
        val last4 = LAST4.find(all)?.let { m -> m.groupValues[1].ifEmpty { m.groupValues[2] } }
        val merchant = (LOCAL.find(all) ?: AT.find(all))?.groupValues?.get(1)?.trim()?.take(80).orEmpty()
        return Read(bank, amount, last4, merchant)
    }

    /** The Worker takes up to R$ 100.000,00 at once. */
    private const val MAX_CENTS = 100_000_00L
}
