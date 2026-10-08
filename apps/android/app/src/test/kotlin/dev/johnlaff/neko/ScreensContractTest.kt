package dev.johnlaff.neko

import dev.johnlaff.neko.data.AjustesView
import dev.johnlaff.neko.data.InstallmentSimulation
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
        assertTrue(now.days.isNotEmpty())
        assertTrue(now.days.all { it.band in setOf("negative", "attention", "healthy", "surplus") })
        // What the month kept, and what it cost without that.
        assertTrue(now.saved > 0)
        assertEquals(now.saida + now.diario - now.saved, now.livingCost)
        assertTrue(now.savedShare != null)
        // The emergency reserve and the Economia tab, from the same months.
        val r = v.reserve!!
        assertEquals(r.cost * 6, r.min)
        assertEquals(r.cost * 12, r.max)
        assertEquals((r.kept * 10 / r.cost).toInt(), r.coveredTenths)
        assertEquals(v.months.filter { it.year == 2026 }.sumOf { it.saved }, v.years.single { it.year == 2026 }.saved)
    }

    @Test fun simulate() {
        val v = json.decodeFromString<InstallmentSimulation>(text("simulate.json"))
        assertEquals(3, v.parcels.size)
        assertEquals(60_000L, v.parcels.sumOf { it.amount })
        assertEquals(null, v.firstNegative)
    }

    @Test fun ajustes() {
        val v = json.decodeFromString<AjustesView>(text("ajustes.json"))
        assertEquals(15_000L, v.settings.dailyForecast)
        assertEquals(listOf("Cartão Verde"), v.settings.othersCards)
        assertEquals(2, v.cards.size)
    }
}
