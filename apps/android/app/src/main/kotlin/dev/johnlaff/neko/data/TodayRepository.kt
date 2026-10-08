package dev.johnlaff.neko.data

/**
 * The last Hoje read from the Worker, kept on disk: the widget draws from it, and the app shows it
 * at once while a fresh read is on the way (or when the phone is offline).
 */
class TodayRepository(private val api: Api, private val cache: ViewCache<TodayView>) {
    suspend fun cached(): TodayView? = cache.read()

    /** The widget's read: Glance calls it on a background thread. */
    fun cachedNow(): TodayView? = cache.readNow()

    suspend fun refresh(): TodayView = api.today().also { cache.write(it) }

    fun clear() = cache.clear()
}
