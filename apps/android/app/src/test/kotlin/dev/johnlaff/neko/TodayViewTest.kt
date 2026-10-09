package dev.johnlaff.neko

import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.data.SimulatedCycle
import dev.johnlaff.neko.ui.Copy
import dev.johnlaff.neko.ui.simFigure
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
        // The fixture has the Diário previsto on: the dial follows the month.
        assertEquals("month", view.canSpend?.mode)
        assertEquals(4, view.canSpend?.daysBehind)
        assertEquals(10_000L, view.previsto?.review?.real)
        assertEquals(2, view.upcoming.size)
        assertEquals(view.upcomingCount, view.upcoming.sumOf { it.items.size })
    }

    /** The usual card's cycle, past its plan. */
    private val over = view.canSpend!!.copy(mode = "cycle", pace = "over", perDay = -2_000, overBy = 30_000, daysBehind = 0)

    @Test fun simulatorOverThePlanSaysByHowMuchNotANegativePerDay() {
        val cs = over
        // The card is over: before a value is typed the figure must not read "-R$ … por dia".
        val before = simFigure(cs, null)
        assertEquals("Passa do plano", before.label)
        assertEquals(cs.overBy, before.amount)
        assertTrue(before.over)
        assertEquals("Sobra por dia", simFigure(cs.copy(perDay = 12_000), null).label)
        assertEquals(30_000L, simFigure(cs, SimulatedCycle(-1_000, -30_000, cs.due)).amount)
        assertEquals("Sobra por dia", simFigure(cs, SimulatedCycle(8_000, 80_000, cs.due)).label)
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

    @Test fun saysTheMonthsWinsAndSkipsUnknownOnes() {
        val wins = view.recap!!.wins
        assertEquals(listOf("3 meses seguidos no azul"), wins.mapNotNull(dev.johnlaff.neko.ui.Copy::win))
        assertEquals(null, dev.johnlaff.neko.ui.Copy.win(dev.johnlaff.neko.data.Win("novo")))
        assertEquals("Mês no azul", dev.johnlaff.neko.ui.Copy.win(dev.johnlaff.neko.data.Win("blue", months = 1)))
        assertEquals(
            "Recorde: o mês que mais guardou até aqui",
            dev.johnlaff.neko.ui.Copy.winShare(dev.johnlaff.neko.data.Win("record", share = 34)),
        )
        assertEquals(
            "Faturas do cartão menores que as do mês anterior",
            dev.johnlaff.neko.ui.Copy.win(dev.johnlaff.neko.data.Win("cards-down")),
        )
        assertEquals(
            "Recorde: guardou 34% das entradas, o maior até aqui",
            dev.johnlaff.neko.ui.Copy.win(dev.johnlaff.neko.data.Win("record", share = 34)),
        )
    }

    @Test fun widgetAndTileCarryTheStreak() {
        val t = widgetText(view)
        assertEquals("Planilha em dia · 12 dias", t.streak)
        assertEquals(7, t.week.size)
        val tile = dev.johnlaff.neko.tile.tileText(view)
        assertEquals("Planilha em dia · 12 dias", tile.subtitle)
        assertEquals(true, tile.active)
        val logged = view.copy(habit = view.habit!!.copy(editedToday = true))
        assertEquals(false, dev.johnlaff.neko.tile.tileText(logged).active)
        assertEquals("Hoje já lançado", dev.johnlaff.neko.tile.tileText(logged).subtitle)
    }

    @Test fun everyWarningHasText() {
        view.insights.forEach { assertNotNull(it.kind, Copy.insight(it)) }
    }

    @Test fun widgetSaysWhenThePlanIsPassed() {
        val t = widgetText(view.copy(canSpend = over))
        assertEquals("Passou do plano", t.caption)
        assertEquals(true, t.alarm)
    }

    @Test fun widerWidgetsAddTheBillAndTheNextDays() {
        val t = widgetText(view)
        val cs = view.canSpend!!
        assertEquals(dev.johnlaff.neko.ui.Format.money(cs.accumulated), t.bill)
        assertEquals("de ${dev.johnlaff.neko.ui.Format.money(cs.budget)} previstos", t.billDetail)
        assertEquals("Gasto no mês", t.billLabel)
        assertEquals("por dia · até 31 out", t.footer)
        assertEquals("de ${dev.johnlaff.neko.ui.Format.money(cs.budget)} do plano", widgetText(view.copy(canSpend = over)).billDetail)
        assertEquals(view.upcoming.size.coerceAtMost(3), t.days.size)
        assertEquals("Hoje", t.days.first().label)
        assertEquals(true, t.days.first().income)
    }

    @Test fun widgetAsksToSignInWithoutData() {
        assertEquals("Entrar", widgetText(null).figure)
    }
}
