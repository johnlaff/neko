package dev.johnlaff.neko.ui

/**
 * Mia's words at reading pace (the site's miaPace.ts): what arrives in bursts shows as a steady
 * flow, word by word, each word fading in. Never slower than [MIN], never more than about [LAG]
 * behind what arrived, so a fast answer is not held back.
 */
object Mia2Pace {
    /** Characters per second when little is waiting. */
    const val MIN = 90f
    /** Seconds: how far behind what arrived the words may run. */
    const val LAG = 0.4f
    /** How long a new word takes to fade in. */
    const val FADE_MS = 250

    /** Where the reveal is after [dt] seconds, from [pos], with [length] characters arrived. */
    fun step(pos: Float, length: Int, dt: Float): Float =
        minOf(length.toFloat(), pos + maxOf(MIN, (length - pos) / LAG) * dt)

    /**
     * How much of [text] shows with the reveal at [pos]: whole words only, "R$" with its amount, a
     * list's mark with its item, and the last word only once the text is [done] (it may still grow).
     */
    fun cut(text: String, pos: Float, done: Boolean): Int {
        var at = minOf(text.length, kotlin.math.ceil(pos.toDouble()).toInt())
        if (at <= 0) return 0
        // The word the reveal is in shows whole, up to the space after it.
        while (at < text.length) {
            while (at < text.length && !text[at].isWhitespace()) at++
            if (at < text.length && glued(text.substring(0, at))) {
                at++
                continue
            }
            break
        }
        if (at < text.length || done) return at
        // The last word may still be coming: it waits for the space after it, and so does an "R$" or
        // a list's mark that goes with it.
        var end = before(text, text.length)
        if (glued(text.substring(0, end))) end = before(text, end)
        return end
    }

    private val MARK = Regex("""(?:^|\n)[ \t]*(?:[-*]|\d+\.)$""")

    /** A word that never shows alone: "R$" without its amount, or a list's mark without its item. */
    private fun glued(head: String): Boolean = head.endsWith("R$") || MARK.containsMatchIn(head)

    /** Where the last whole word before [end] ends: a word cut at [end] does not count. */
    private fun before(text: String, end: Int): Int {
        var at = end
        while (at > 0 && !text[at - 1].isWhitespace()) at--
        while (at > 0 && text[at - 1].isWhitespace()) at--
        return at
    }
}
