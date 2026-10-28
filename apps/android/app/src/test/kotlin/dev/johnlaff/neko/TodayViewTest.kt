package dev.johnlaff.neko

import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.data.SimulatedCycle
import dev.johnlaff.neko.ui.Copy
import dev.johnlaff.neko.ui.SimFigure
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
        // What still fits of the month's Diário, never split by the days left.
        assertEquals(294_500L - 73_220L, view.canSpend?.left)
        assertEquals(4, view.canSpend?.daysBehind)
        assertEquals(10_000L, view.previsto?.review?.real)
        assertEquals(2, view.upcoming.size)
        assertEquals(view.upcomingCount, view.upcoming.sumOf { it.items.size })
    }

    /** The usual card's cycle, past its plan. */
    private val over = view.canSpend!!.copy(mode = "cycle", pace = "over", left = 0, overBy = 30_000)

    @Test fun simulatorSaysWhatStillFitsNeverPerDay() {
        val cs = over
        // The card is over: before a value is typed the figure says by how much.
        val before = simFigure(cs, null)
        assertEquals("Passa do plano", before.label)
        assertEquals(cs.overBy, before.amount)
        assertTrue(before.over)
        val under = cs.copy(pace = "on-pace", left = 120_000, overBy = 0)
        assertEquals(SimFigure("Ainda cabem", 120_000, false), simFigure(under, null))
        assertEquals(30_000L, simFigure(cs, SimulatedCycle(-30_000, cs.due)).amount)
        assertEquals(SimFigure("Ainda cabem", 80_000, false), simFigure(cs, SimulatedCycle(80_000, cs.due)))
        // Under a ceiling for the cards, going past it is passing the ceiling.
        assertEquals("Passa do teto", simFigure(cs.copy(mode = "cards"), SimulatedCycle(-2_000, cs.due)).label)
    }

    @Test fun readsTheStreak() {
        val h = view.habit!!
        assertEquals(12, h.streak)
        assertEquals(7, h.week.size)
        assertEquals("today", h.week[1].state)
        assertEquals(21, h.next)
    }

    @Test fun saysTheMonthsWinsAndSkipsUnknownOnes() {
        val wins = listOf(dev.johnlaff.neko.data.Win("blue", months = 3), dev.johnlaff.neko.data.Win("novo"))
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
        // What waits in Para lançar is the invitation; with nothing waiting, the streak speaks.
        assertEquals("${view.queue!!.size} para lançar", t.toLaunch)
        assertEquals(null, widgetText(view.copy(queue = emptyList())).toLaunch)
        assertEquals(null, widgetText(view.copy(queue = null)).toLaunch)
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
        // In the month, the plan is the Diário previsto: the same word as Hoje's.
        assertEquals("Passou do previsto", widgetText(view.copy(canSpend = over.copy(mode = "month"))).caption)
    }

    @Test fun widerWidgetsAddTheBillAndTheNextDays() {
        val cs = view.canSpend!!
        val onPace = widgetText(view.copy(canSpend = cs.copy(paceGap = 0, daysBehind = 0, pace = "on-pace")))
        assertEquals(dev.johnlaff.neko.ui.Format.money(cs.accumulated), onPace.bill)
        assertEquals("de ${dev.johnlaff.neko.ui.Format.money(cs.budget)} no mês", onPace.billDetail)
        assertEquals("Gasto no mês", onPace.billLabel)
        assertEquals(false, onPace.billWarn)
        // Ahead of the Diário, the warning Hoje keeps takes the bill's place, in the same words.
        val t = widgetText(view)
        assertEquals("Acima do previsto", t.billLabel)
        assertEquals(dev.johnlaff.neko.ui.Format.money(35_220), t.bill)
        assertEquals("Uns 4 dias sem gastar", t.billDetail)
        assertEquals(true, t.billWarn)
        assertEquals("Ainda cabem", t.caption)
        assertEquals(dev.johnlaff.neko.ui.Format.money(cs.left), t.figure)
        assertEquals("no mês · até 31 out", t.footer)
        assertEquals("de ${dev.johnlaff.neko.ui.Format.money(cs.budget)} do plano", widgetText(view.copy(canSpend = over)).billDetail)
        assertEquals(view.upcoming.size.coerceAtMost(3), t.days.size)
        assertEquals("Hoje", t.days.first().label)
        assertEquals(true, t.days.first().income)
    }

    @Test fun widgetLeadsWithWhatStillFitsUnderTheMonthsCeiling() {
        val cards = view.canSpend!!.copy(mode = "cards", budget = 350_000, accumulated = 100_000, left = 250_000, used = 0, pace = "on-pace", due = "2026-11-30")
        val t = widgetText(view.copy(canSpend = cards))
        assertEquals("Ainda cabem", t.caption)
        assertEquals(dev.johnlaff.neko.ui.Format.money(250_000), t.figure)
        assertEquals("em cartões e Pix", t.footer)
        assertEquals("Cartões e Pix", t.billLabel)
        val past = cards.copy(accumulated = 210_000, left = 0, overBy = 10_000, used = 100, pace = "over")
        assertEquals("Passou do teto", widgetText(view.copy(canSpend = past)).caption)
    }

    @Test fun widgetAsksToSignInWithoutData() {
        assertEquals("Entrar", widgetText(null).figure)
    }
}
