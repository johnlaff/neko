package dev.johnlaff.neko.data

/**
 * The last Hoje read from the Worker, kept on disk: the widget draws from it, and the app shows it
 * at once while a fresh read is on the way (or when the phone is offline).
 */
class TodayRepository(private val api: Api, private val cache: SealedFile) {
    fun cached(): TodayView? =
        cache.read()?.let { runCatching { json.decodeFromString<TodayView>(it) }.getOrNull() }

    suspend fun refresh(): TodayView {
        val view = api.today()
        cache.write(json.encodeToString(TodayView.serializer(), view))
        return view
    }

    fun clear() {
        cache.delete()
    }
}
