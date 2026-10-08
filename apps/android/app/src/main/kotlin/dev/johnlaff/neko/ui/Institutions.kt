package dev.johnlaff.neko.ui

import androidx.annotation.DrawableRes
import dev.johnlaff.neko.R
import java.text.Normalizer

/**
 * A bank or card issuer recognised by a card's name, shown by its official mark (one colour,
 * res/drawable/bank_*.xml) on its brand colour. The same table and matching as the site's
 * shared/institutions.ts; ScreensContractTest reads its cases from the Worker's tests.
 */
data class Institution(val slug: String, val words: List<String>, val bg: Long, val fg: Long, @param:DrawableRes val mark: Int)

/** The first match wins: Amazon comes first because its card is issued by Bradescard. */
val INSTITUTIONS = listOf(
    Institution("amazon", listOf("amazon"), 0xFF232F3E, 0xFFFF9900, R.drawable.bank_amazon),
    Institution("itau", listOf("itau", "itaucard"), 0xFFFF6200, 0xFFFFFFFF, R.drawable.bank_itau),
    Institution("bradesco", listOf("bradesco"), 0xFFCC092F, 0xFFFFFFFF, R.drawable.bank_bradesco),
    Institution("inter", listOf("inter", "banco inter"), 0xFFEA7100, 0xFFFFFFFF, R.drawable.bank_inter),
    Institution("nubank", listOf("nubank", "nu"), 0xFF820AD1, 0xFFFFFFFF, R.drawable.bank_nubank),
    Institution("mercadopago", listOf("mercado pago", "mercadopago"), 0xFF00BCFF, 0xFF0A0080, R.drawable.bank_mercadopago),
    Institution("bancodobrasil", listOf("banco do brasil", "bb", "ourocard"), 0xFFFCFC30, 0xFF465EFF, R.drawable.bank_bancodobrasil),
    Institution("sicoob", listOf("sicoob", "sicoobcard"), 0xFF003641, 0xFFC9D200, R.drawable.bank_sicoob),
    Institution("santander", listOf("santander"), 0xFFEC0000, 0xFFFFFFFF, R.drawable.bank_santander),
    Institution("caixa", listOf("caixa", "cef"), 0xFF005CA9, 0xFFFFFFFF, R.drawable.bank_caixa),
    Institution("c6bank", listOf("c6", "c6 bank", "c6bank"), 0xFF242424, 0xFFFFFFFF, R.drawable.bank_c6bank),
    Institution("picpay", listOf("picpay"), 0xFF21C25E, 0xFFFFFFFF, R.drawable.bank_picpay),
    Institution("xp", listOf("xp", "xp investimentos"), 0xFF000000, 0xFFFFFFFF, R.drawable.bank_xp),
)

/** Lowercase words without accents: "Itaú Personnalité" → " itau personnalite ". Shared with categoryOf. */
internal fun wordsOf(s: String): String {
    val plain = Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase()
    return " " + plain.replace(Regex("[^a-z0-9]+"), " ").trim() + " "
}

/** The issuer a card's name points to, by whole words only ("Inter" yes, "Internet" no). */
fun institutionOf(name: String): Institution? {
    val w = wordsOf(name)
    return INSTITUTIONS.firstOrNull { i -> i.words.any { w.contains(" $it ") } }
}
