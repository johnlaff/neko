package dev.johnlaff.neko

import dev.johnlaff.neko.ui.Mia2Pace
import org.junit.Assert.assertEquals
import org.junit.Test

/** The same cases as the site's mia-pace.test.ts: both show her words the same way. */
class Mia2PaceTest {
    @Test fun goesAtLeastMinCharactersASecond() {
        assertEquals(Mia2Pace.MIN * 0.05f, Mia2Pace.step(0f, 10, 0.05f), 0.001f)
        assertEquals(10f, Mia2Pace.step(9f, 10, 1f), 0f)
    }

    @Test fun isNeverMuchMoreThanLagBehindABurst() {
        var pos = 0f
        var t = 0f
        while (t < 1.6f) {
            pos = Mia2Pace.step(pos, 600, 1f / 60)
            t += 1f / 60
        }
        assertEquals(600f, pos, 0f)
        assertEquals(600f / Mia2Pace.LAG / 60, Mia2Pace.step(0f, 600, 1f / 60), 0.01f)
    }

    @Test fun showsWholeWordsRealWithItsAmountAndTheLastWordOnceComplete() {
        val text = "Ainda cabem R$ 1.240,60 no teto"
        assertEquals(0, Mia2Pace.cut(text, 0f, false))
        assertEquals("Ainda".length, Mia2Pace.cut(text, 1f, false))
        assertEquals("Ainda cabem".length, Mia2Pace.cut(text, 7f, false))
        assertEquals("Ainda cabem R$ 1.240,60".length, Mia2Pace.cut(text, 13f, false))
        // "teto" may still be growing until a space comes or the text is done.
        assertEquals("Ainda cabem R$ 1.240,60 no".length, Mia2Pace.cut(text, 40f, false))
        assertEquals(text.length, Mia2Pace.cut(text, 40f, true))
        assertEquals("Ainda cabem".length, Mia2Pace.cut("Ainda cabem R$", 40f, false))
        assertEquals("Ainda cabem".length, Mia2Pace.cut("Ainda cabem R$ ", 40f, false))
        assertEquals("Outubro fechou".length, Mia2Pace.cut("Outubro fechou ", 40f, false))
        assertEquals("Fatura\n\n- Pix:".length, Mia2Pace.cut("Fatura\n\n- Pix: R$ 12", 10f, false))
        // A list's mark never shows without its item, as R$ never shows without its amount.
        assertEquals("- Faturas:".length, Mia2Pace.cut("- Faturas: R$ 3", 1f, false))
        assertEquals("Fatura".length, Mia2Pace.cut("Fatura\n\n- Pix", 9f, false))
        assertEquals("Fatura\n1. Pix".length, Mia2Pace.cut("Fatura\n1. Pix e débito", 8f, false))
        assertEquals("a -".length, Mia2Pace.cut("a - b c", 3f, false))
    }
}
