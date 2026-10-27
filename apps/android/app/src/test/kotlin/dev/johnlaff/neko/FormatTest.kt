package dev.johnlaff.neko

import dev.johnlaff.neko.ui.Format
import org.junit.Assert.assertEquals
import org.junit.Test

/** What only the app formats: typed amounts and "Usado há 12 dias". The rest is checked against the site in CopyContractTest. */
class FormatTest {
    @Test fun typedMoney() {
        assertEquals(17_700L, Format.toCents("177,00"))
        assertEquals(500_000L, Format.toCents(" 5.000 "))
        assertEquals(12_35L, Format.toCents("12,345"))
        assertEquals(null, Format.toCents(""))
        assertEquals(null, Format.toCents("abc"))
        assertEquals(null, Format.toCents("-3"))
        assertEquals("177,00", Format.fromCents(17_700))
        assertEquals("0,05", Format.fromCents(5))
        assertEquals("", Format.fromCents(null))
    }

    @Test fun lastUsed() {
        val zone = java.time.ZoneId.systemDefault()
        val now = java.time.LocalDate.of(2026, 10, 8)
        fun at(d: java.time.LocalDate) = d.atTime(12, 0).atZone(zone).toInstant().toString()
        assertEquals("Usado hoje", dev.johnlaff.neko.ui.lastUsed(at(now), now))
        assertEquals("Usado ontem", dev.johnlaff.neko.ui.lastUsed(at(now.minusDays(1)), now))
        assertEquals("Usado há 12 dias", dev.johnlaff.neko.ui.lastUsed(at(now.minusDays(12)), now))
        assertEquals("Usado antes", dev.johnlaff.neko.ui.lastUsed("ontem", now))
    }
}
