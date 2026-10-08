package dev.johnlaff.neko.security

/**
 * When the app lock asks again: on every new start of the app, and on coming back after [grace]
 * away. Times are any monotonic clock in milliseconds; the activity passes elapsedRealtime().
 */
class LockClock(private val grace: Long = 5 * 60_000L) {
    private var unlocked = false
    private var leftAt: Long? = null

    /** The app went to the background (not a rotation). */
    fun left(now: Long) {
        leftAt = now
    }

    /** The app is shown again: whether it must be unlocked first. */
    fun locked(now: Long, enabled: Boolean): Boolean {
        if (!enabled) return false
        val away = leftAt?.let { now - it } ?: 0L
        leftAt = null
        if (away >= grace) unlocked = false
        return !unlocked
    }

    fun unlock() {
        unlocked = true
        leftAt = null
    }
}
