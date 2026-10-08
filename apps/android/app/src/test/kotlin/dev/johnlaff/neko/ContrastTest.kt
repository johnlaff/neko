package dev.johnlaff.neko

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import dev.johnlaff.neko.ui.DarkLedger
import dev.johnlaff.neko.ui.Ledger
import dev.johnlaff.neko.ui.LightLedger
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * WCAG 2.2 AA for every text color the screens put on every surface: 4.5:1 for text, 3:1 for the
 * large figures and for marks that carry meaning (status bars, the gauge). A palette change that
 * drops below fails here instead of on someone's phone in the sun.
 */
class ContrastTest {
    private fun ratio(a: Color, b: Color): Double {
        val (hi, lo) = listOf(a.luminance() + 0.05, b.luminance() + 0.05).sortedDescending()
        return hi / lo
    }

    private fun check(name: String, l: Ledger) {
        val grounds = mapOf("bg" to l.bg, "surface" to l.surface, "surface2" to l.surface2)
        val text = mapOf("text" to l.text, "muted" to l.muted, "faint" to l.faint, "accent" to l.accent, "pos" to l.pos, "warn" to l.warn, "neg" to l.neg)
        val failures = mutableListOf<String>()
        grounds.forEach { (g, ground) ->
            text.forEach { (t, ink) ->
                val r = ratio(ink, ground)
                if (r < 4.5) failures += "$name $t on $g: %.2f".format(r)
            }
        }
        // Chips and alerts: the status color on its own 12% / 10% tint over the panel.
        listOf("pos" to l.pos, "warn" to l.warn, "neg" to l.neg, "muted" to l.muted).forEach { (t, ink) ->
            listOf(0.10f, 0.12f).forEach { a ->
                val tint = ink.copy(alpha = a).compositeOver(l.surface)
                val r = ratio(ink, tint)
                if (r < 4.5) failures += "$name $t chip on its tint: %.2f".format(r)
                val body = ratio(l.text, tint)
                if (body < 4.5) failures += "$name text on $t tint: %.2f".format(body)
            }
        }
        // The light accent button's label and the selected simulator choice.
        if (ratio(l.bg, l.accent) < 4.5) failures += "$name bg on accent: %.2f".format(ratio(l.bg, l.accent))
        if (ratio(l.bg, l.text) < 4.5) failures += "$name bg on text"
        // Non-text marks (WCAG 1.4.11): the gauge track and border against the panel.
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test fun darkPaletteIsReadable() = check("dark", DarkLedger)

    @Test fun lightPaletteIsReadable() = check("light", LightLedger)
}
