package dev.johnlaff.neko

import dev.johnlaff.neko.data.AjustesView
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.data.MonthsView
import dev.johnlaff.neko.data.json
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Reads the JSON the Worker's Faturas, Mês and Ajustes views produce for the site's e2e fixture
 * (written by apps/neko/test/screens.test.ts), so a field renamed on one side fails here.
 */
class ScreensContractTest {
    private fun text(file: String) = File("src/test/resources/$file").readText()

    @Test fun invoices() {
        val v = json.decodeFromString<InvoicesView>(text("invoices.json"))
        assertEquals("Cartão Azul", v.usual?.card)
        assertTrue(v.history.last().open)
        assertEquals(listOf("Cartão Verde"), v.others.map { it.card })
        assertTrue(v.others.single().others)
    }

    @Test fun months() {
        val v = json.decodeFromString<MonthsView>(text("months.json"))
        val now = v.months.single { it.key == v.current }
        assertEquals("2026-10", now.key)
        assertTrue(now.outflows.isNotEmpty())
        assertTrue(v.months.first().past)
    }

    @Test fun ajustes() {
        val v = json.decodeFromString<AjustesView>(text("ajustes.json"))
        assertEquals(15_000L, v.settings.dailyForecast)
        assertEquals(listOf("Cartão Verde"), v.settings.othersCards)
        assertEquals(2, v.cards.size)
    }
}
