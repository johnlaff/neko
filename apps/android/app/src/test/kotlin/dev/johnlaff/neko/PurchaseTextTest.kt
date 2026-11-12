package dev.johnlaff.neko

import dev.johnlaff.neko.purchases.PurchaseText
import dev.johnlaff.neko.purchases.PurchaseText.Read
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Invented notices in the shapes banks use (public repo: no real shop, card or amount). */
class PurchaseTextTest {
    private fun read(pkg: String, title: String, text: String) = PurchaseText.read(pkg, title, text)

    @Test
    fun `takes the amount, the card's last digits and the shop`() {
        assertEquals(
            Read("Bradesco", 4590, "1234", "LIVRARIA CENTRAL"),
            read("br.com.bradesco.cartoes", "Compra aprovada", "Compra de R$ 45,90 aprovada em LIVRARIA CENTRAL no cartão final 1234."),
        )
        assertEquals(
            Read("Itaú", 123456, "5678", "PADARIA BOA VISTA"),
            read("com.itaucard.activity", "Itaú", "Cartão final 5678 COMPRA APROVADA 10/11 15:02 R$ 1.234,56 Local: PADARIA BOA VISTA."),
        )
        assertEquals(
            Read("Inter", 2000, "4321", "CAFE.COM.BR"),
            read("br.com.intermedium", "Compra aprovada no crédito", "Você fez uma compra de R$ 20,00 em CAFE.COM.BR com o cartão final 4321"),
        )
        assertEquals(
            Read("Mercado Pago", 8990, null, "MERCADO ESQUINA"),
            read("com.mercadopago.wallet", "Compra aprovada", "Você comprou R$ 89,90 em MERCADO ESQUINA com seu cartão de crédito."),
        )
        assertEquals(
            Read("Itaú", 3200, "2468", "CASA DE CARNES"),
            read("com.itau", "Compra aprovada", "R$ 32 em CASA DE CARNES na função crédito, cartão **** 2468"),
        )
    }

    @Test
    fun `takes the purchase's amount, not the limit after it, and no shop when the notice names none`() {
        assertEquals(
            Read("Bradesco", 4590, null, "LOJA DO BAIRRO"),
            read("com.bradesco", "Compra aprovada", "Compra de R$ 45,90 em LOJA DO BAIRRO. Limite disponível: R$ 5.000,00"),
        )
        assertEquals(
            Read("Bradesco", 1500, "1111", ""),
            read("com.bradesco", "Compra aprovada", "Compra de R$ 15,00 aprovada em seu cartão final 1111"),
        )
        assertEquals(
            Read("Bradesco", 750, "9999", ""),
            read("com.bradesco", "COMPRA APROVADA", "CARTAO FINAL 9999 DE R$ 7,50 EM 10/11/2026 15:02 SORVETERIA"),
        )
    }

    @Test
    fun `leaves alone what is not an approved credit purchase paid at once`() {
        val bradesco = "br.com.bradesco.cartoes"
        assertNull(read(bradesco, "Compra aprovada", "Compra no débito de R$ 10,00 em LOJA"))
        assertNull(read(bradesco, "Pix enviado", "Você enviou um Pix de R$ 50,00"))
        assertNull(read(bradesco, "Compra recusada", "Compra de R$ 30,00 em LOJA recusada"))
        assertNull(read(bradesco, "Compra não aprovada", "Compra de R$ 30,00 em LOJA"))
        assertNull(read(bradesco, "Compra aprovada", "Compra de R$ 300,00 em 3x em LOJA"))
        assertNull(read(bradesco, "Compra aprovada", "Compra parcelada de R$ 300,00 em LOJA"))
        assertNull(read(bradesco, "Estorno", "Estorno da compra de R$ 20,00 aprovado"))
        assertNull(read(bradesco, "Compra aprovada", "Compra de US$ 10,00 aprovada em LOJA"))
        assertNull(read(bradesco, "Compra em análise", "Compra de R$ 10,00 em LOJA"))
        assertNull(read(bradesco, "Fatura", "Sua fatura de R$ 900,00 fechou"))
        // Any other app, even with the same words.
        assertNull(read("com.example.chat", "Compra aprovada", "Compra de R$ 45,90 em LOJA"))
    }

    @Test
    fun `keeps the words of a listed bank's notice of a purchase or a card, never of Pix`() {
        val bradesco = "br.com.bradesco.cartoes"
        assertTrue(PurchaseText.keep(bradesco, "Compra aprovada", "Compra de R$ 45,90 em LOJA"))
        // Not read, and still kept: a wording this reader does not know yet.
        assertTrue(PurchaseText.keep(bradesco, "Transação aprovada", "Cartão final 1234: R$ 45,90 LOJA"))
        assertTrue(PurchaseText.keep(bradesco, "Compra aprovada", "Compra no débito de R$ 10,00 em LOJA"))
        assertFalse(PurchaseText.keep(bradesco, "Pix enviado", "Você enviou um Pix de R$ 50,00 no cartão"))
        assertFalse(PurchaseText.keep(bradesco, "Compra aprovada", "Sua compra foi aprovada"))
        assertFalse(PurchaseText.keep(bradesco, "Bom dia", "Confira as ofertas de hoje"))
        assertFalse(PurchaseText.keep("com.example.chat", "Compra aprovada", "Compra de R$ 45,90 em LOJA"))
    }
}
