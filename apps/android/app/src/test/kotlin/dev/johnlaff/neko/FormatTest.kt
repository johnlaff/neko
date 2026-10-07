package dev.johnlaff.neko

import dev.johnlaff.neko.ui.Format
import org.junit.Assert.assertEquals
import org.junit.Test

/** Same strings as the site's format.ts for the same input. */
class FormatTest {
    @Test fun money() {
        assertEquals("R$ 0,00", Format.money(0))
        assertEquals("R$ 1.234,56", Format.money(1_234_56))
        assertEquals("R$ 1.000.000,05", Format.money(1_000_000_05))
        assertEquals("−R$ 7,50", Format.money(-7_50))
    }

    @Test fun signed() {
        assertEquals("+R$ 10,00", Format.signed(10_00, '+'))
        assertEquals("−R$ 10,00", Format.signed(-10_00, '−'))
        assertEquals("R$ 0,00", Format.signed(0, '+'))
    }

    @Test fun dates() {
        assertEquals("13 out", Format.shortDate("2026-10-13"))
        assertEquals("Hoje", Format.relativeDay("2026-10-05", "2026-10-05"))
        assertEquals("Amanhã", Format.relativeDay("2026-10-06", "2026-10-05"))
        assertEquals("Sexta, 9 out", Format.relativeDay("2026-10-09", "2026-10-05"))
        assertEquals("1 dia", Format.days(1))
        assertEquals("3 dias", Format.days(3))
    }
}
