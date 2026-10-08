package dev.johnlaff.neko

import dev.johnlaff.neko.ui.Format
import org.junit.Assert.assertEquals
import org.junit.Test

/** Same strings as the site's format.ts for the same input. */
class FormatTest {
    @Test fun money() {
        assertEquals("R$\u00A00,00", Format.money(0))
        assertEquals("R$\u00A01.234,56", Format.money(1_234_56))
        assertEquals("R$\u00A01.000.000,05", Format.money(1_000_000_05))
        assertEquals("−R$\u00A07,50", Format.money(-7_50))
    }

    @Test fun signed() {
        assertEquals("+R$\u00A010,00", Format.signed(10_00, '+'))
        assertEquals("−R$\u00A010,00", Format.signed(-10_00, '−'))
        assertEquals("R$\u00A00,00", Format.signed(0, '+'))
    }

    @Test fun dates() {
        assertEquals("13 out", Format.shortDate("2026-10-13"))
        assertEquals("Hoje", Format.relativeDay("2026-10-05", "2026-10-05"))
        assertEquals("Amanhã", Format.relativeDay("2026-10-06", "2026-10-05"))
        assertEquals("Sexta, 9 out", Format.relativeDay("2026-10-09", "2026-10-05"))
        assertEquals("1 dia", Format.days(1))
        assertEquals("3 dias", Format.days(3))
    }

    @Test fun closesIn() {
        // closesInDays counts today: 1 is today, 2 tomorrow, 4 is three days away.
        assertEquals("Fecha hoje", Format.closesIn(1))
        assertEquals("Fecha amanhã", Format.closesIn(2))
        assertEquals("Fecha em 3 dias", Format.closesIn(4))
    }

    @Test fun bankText() {
        // A bank's capitals read as a name, keeping small words and codes; lowercase stays as sent.
        assertEquals("Pix Feira do Bairro", Format.bankText("PIX FEIRA DO BAIRRO"))
        assertEquals("Pix Recebido Ana", Format.bankText("PIX RECEBIDO ANA"))
        assertEquals("Pag*loja 123 São Paulo", Format.bankText("PAG*LOJA 123 SÃO PAULO"))
        assertEquals("Uber *Trip", Format.bankText("Uber *Trip"))
    }

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
