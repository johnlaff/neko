package dev.johnlaff.neko

import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.ui.Copy
import dev.johnlaff.neko.widget.widgetText
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * Reads the JSON the Worker's todayView produces for the site's e2e fixture (written by
 * apps/neko/test/android.test.ts), so a field renamed on one side fails here.
 */
class TodayViewTest {
    private val view: TodayView =
        json.decodeFromString(File("src/test/resources/today.json").readText())

    @Test fun parsesWhatTheWorkerSends() {
        assertEquals("2026-10-05", view.today)
        assertEquals("Cartão Azul", view.canSpend?.card)
        assertEquals("over", view.canSpend?.pace)
        assertEquals(2, view.upcoming.size)
        assertEquals(view.upcomingCount, view.upcoming.sumOf { it.items.size })
    }

    @Test fun readsTheStreak() {
        val h = view.habit!!
        assertEquals(12, h.streak)
        assertEquals(7, h.week.size)
        assertEquals("today", h.week[1].state)
        assertEquals(21, h.next)
    }

    @Test fun readsTheClosedMonth() {
        val r = view.recap!!
        assertEquals(9, r.month)
        assertTrue(r.livingCost > 0)
        assertTrue(r.top != null)
    }

    @Test fun widgetAndTileCarryTheStreak() {
        val t = widgetText(view)
        assertEquals("12 dias em dia", t.streak)
        assertEquals(7, t.week.size)
        val tile = dev.johnlaff.neko.tile.tileText(view)
        assertEquals("12 dias em dia", tile.subtitle)
        assertEquals(true, tile.active)
        val logged = view.copy(habit = view.habit!!.copy(editedToday = true))
        assertEquals(false, dev.johnlaff.neko.tile.tileText(logged).active)
        assertEquals("Hoje já lançado", dev.johnlaff.neko.tile.tileText(logged).subtitle)
    }

    @Test fun everyWarningHasText() {
        view.insights.forEach { assertNotNull(it.kind, Copy.insight(it)) }
    }

    @Test fun widgetSaysWhenThePlanIsPassed() {
        val t = widgetText(view)
        assertEquals("Passou do plano", t.caption)
        assertEquals(true, t.alarm)
    }

    @Test fun widerWidgetsAddTheBillAndTheNextDays() {
        val t = widgetText(view)
        val cs = view.canSpend!!
        assertEquals(dev.johnlaff.neko.ui.Format.money(cs.accumulated), t.bill)
        assertEquals("de ${dev.johnlaff.neko.ui.Format.money(cs.budget)} do plano", t.billDetail)
        assertEquals(view.upcoming.size.coerceAtMost(3), t.days.size)
        assertEquals("Hoje", t.days.first().label)
        assertEquals(true, t.days.first().income)
    }

    @Test fun widgetAsksToSignInWithoutData() {
        assertEquals("Entrar", widgetText(null).figure)
    }
}
