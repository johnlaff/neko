package dev.johnlaff.neko

import dev.johnlaff.neko.security.LockClock
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LockClockTest {
    private val minute = 60_000L

    @Test fun offNeverLocks() {
        assertFalse(LockClock().locked(0, enabled = false))
    }

    @Test fun aNewStartAsks() {
        assertTrue(LockClock().locked(0, enabled = true))
    }

    @Test fun aShortTripOutDoesNotAskAgain() {
        val c = LockClock(grace = 5 * minute)
        c.unlock()
        c.left(0)
        assertFalse(c.locked(4 * minute, enabled = true))
    }

    @Test fun fiveMinutesAwayAsksAgain() {
        val c = LockClock(grace = 5 * minute)
        c.unlock()
        c.left(0)
        assertTrue(c.locked(5 * minute, enabled = true))
    }

    @Test fun cancellingTheSystemPromptKeepsItLocked() {
        // The screen-lock prompt sends the app to the background for a moment; that is not an unlock.
        val c = LockClock()
        assertTrue(c.locked(0, enabled = true))
        c.left(1_000)
        assertTrue(c.locked(2_000, enabled = true))
    }

    @Test fun turningItOnAfterConfirmingDoesNotLockAtOnce() {
        val c = LockClock()
        c.unlock()
        assertFalse(c.locked(10, enabled = true))
    }
}
