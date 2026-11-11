package dev.johnlaff.neko

import dev.johnlaff.neko.reminders.ReminderClock
import dev.johnlaff.neko.reminders.Slot
import java.time.Duration
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReminderClockTest {
    private val sp = ZoneId.of("America/Sao_Paulo")
    private fun at(day: Int, h: Int, m: Int = 0) = ZonedDateTime.of(2026, 10, day, h, m, 0, 0, sp)

    @Test fun nextHourIsTodayWhenStillAhead() {
        assertEquals(Duration.ofMinutes(90), ReminderClock.untilNext(at(7, 6, 30), 8))
    }

    @Test fun nextHourIsTomorrowOnceItPassed() {
        assertEquals(Duration.ofHours(24), ReminderClock.untilNext(at(7, 8), 8))
        assertEquals(Duration.ofHours(11), ReminderClock.untilNext(at(7, 21), 8))
    }

    @Test fun theMorningLeavesAtTheEveningHourAndTheEveningAtTheNextMorning() {
        assertEquals(Duration.ofHours(14), ReminderClock.keep(at(7, 8), Slot.Morning, 22))
        assertEquals(Duration.ofHours(11), ReminderClock.keep(at(7, 21), Slot.Evening, 21))
        assertEquals(Duration.ofHours(9), ReminderClock.keep(at(7, 23), Slot.Evening, 23))
    }

    @Test fun lateReminderStaysQuiet() {
        assertTrue(ReminderClock.onTime(at(7, 8, 5), 8))
        assertTrue(ReminderClock.onTime(at(7, 7, 50), 8))
        assertFalse(ReminderClock.onTime(at(7, 11, 30), 8))
        assertFalse(ReminderClock.onTime(at(7, 7, 0), 8))
    }
}
