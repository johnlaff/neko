package dev.johnlaff.neko

import dev.johnlaff.neko.data.AjustesView
import dev.johnlaff.neko.data.InstallmentSimulation
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.data.MiaReply
import dev.johnlaff.neko.data.MonthsView
import dev.johnlaff.neko.data.json
import java.io.File
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
        val now = v.months.single { it.key == v.current }
        assertEquals(listOf("Cartão Azul", "Cartão Verde"), now.cards.map { it.card })
        assertEquals(now.cards.sumOf { it.amount }, now.total)
        assertTrue(now.cards.single { it.card == "Cartão Verde" }.others)
        assertTrue(v.months.first().past)
        // The bank's side rides on each card it knows, lines and all.
        val checked = v.months.flatMap { it.cards }.mapNotNull { it.bank }
        assertTrue(checked.isNotEmpty())
        assertTrue(checked.any { it.lines.isNotEmpty() })
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
        // The year counts only what is dated up to today: the fixture's deposit on the 20th is still ahead.
        assertEquals(v.months.filter { it.year == 2026 && it.past }.sumOf { it.saved }, v.years.single { it.year == 2026 }.saved)
    }

    /** The bank table and the card names the Worker's tests match (test/institutions.test.ts). */
    @Test fun institutions() {
        val c = json.parseToJsonElement(text("institutions.json")).jsonObject
        val table = c.getValue("institutions").jsonArray.map { it.jsonObject }
        assertEquals(table.map { it.getValue("slug").jsonPrimitive.content }, dev.johnlaff.neko.ui.INSTITUTIONS.map { it.slug })
        table.zip(dev.johnlaff.neko.ui.INSTITUTIONS).forEach { (t, i) ->
            assertEquals(t.getValue("words").jsonArray.map { it.jsonPrimitive.content }, i.words)
            assertEquals(t.getValue("bg").jsonPrimitive.content.drop(1).toLong(16) or 0xFF000000, i.bg)
            assertEquals(t.getValue("fg").jsonPrimitive.content.drop(1).toLong(16) or 0xFF000000, i.fg)
        }
        c.getValue("cases").jsonObject.forEach { (name, slug) ->
            val want = (slug as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
            assertEquals(name, want, dev.johnlaff.neko.ui.institutionOf(name)?.slug)
        }
    }

    /** The category table and the descriptions the Worker's tests match (shared/categories.ts). */
    @Test fun categories() {
        val c = json.parseToJsonElement(text("categories.json")).jsonObject
        val table = c.getValue("categories").jsonArray.map { it.jsonObject }
        assertEquals(table.map { it.getValue("slug").jsonPrimitive.content }, dev.johnlaff.neko.ui.CATEGORIES.map { it.slug })
        table.zip(dev.johnlaff.neko.ui.CATEGORIES).forEach { (t, k) ->
            assertEquals(t.getValue("words").jsonArray.map { it.jsonPrimitive.content }, k.words)
            assertEquals(t.getValue("icon").jsonPrimitive.content, k.icon)
        }
        c.getValue("cases").jsonObject.forEach { (text, slug) ->
            val want = (slug as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
            assertEquals(text, want, dev.johnlaff.neko.ui.categoryOf(text)?.slug)
        }
        // Every icon parses into a path Compose can draw.
        dev.johnlaff.neko.ui.CATEGORIES.forEach { k ->
            assertTrue(k.slug, androidx.compose.ui.graphics.vector.PathParser().parsePathString(k.icon).toNodes().isNotEmpty())
        }
    }

    /** Lançar com a Mia (apps/neko/test/mia.test.ts): the fields a sentence gave. */
    @Test fun miaEntry() {
        val e = json.decodeFromString<dev.johnlaff.neko.data.MiaEntryReply>(text("mia-lancamento.json")).lancamento!!
        assertEquals("diario", e.kind)
        assertEquals(4590L, e.amount)
        assertEquals("Padaria", e.description)
        assertEquals(null, e.card)
    }

    /** A Mia reply (apps/neko/test/mia.test.ts): a total, a difference and a percent. */
    @Test fun mia() {
        val v = json.decodeFromString<MiaReply>(text("mia.json"))
        assertEquals(setOf("v2", "v3", "v4"), v.valores.keys)
        assertEquals("diferenca", v.valores.getValue("v3").tipo)
        assertEquals(4, v.valores.getValue("v4").pct)
        assertEquals("mes", v.valores.getValue("v2").tela)
        assertEquals("4%", dev.johnlaff.neko.ui.miaShown(v.valores.getValue("v4")))
        // A difference shows its size; the words around it say which way.
        assertEquals(
            dev.johnlaff.neko.ui.miaShown(v.valores.getValue("v3").copy(cents = -32_471)),
            dev.johnlaff.neko.ui.miaShown(v.valores.getValue("v3")),
        )
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
