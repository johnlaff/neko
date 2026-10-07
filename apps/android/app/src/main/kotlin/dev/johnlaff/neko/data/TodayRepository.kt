package dev.johnlaff.neko.data

import java.io.File

/**
 * The last Hoje read from the Worker, kept on disk: the widget draws from it, and the app shows it
 * at once while a fresh read is on the way (or when the phone is offline).
 */
class TodayRepository(private val api: Api, private val cache: File) {
    fun cached(): TodayView? =
        runCatching { json.decodeFromString<TodayView>(cache.readText()) }.getOrNull()

    suspend fun refresh(): TodayView {
        val view = api.today()
        cache.parentFile?.mkdirs()
        val tmp = File(cache.path + ".tmp")
        tmp.writeText(json.encodeToString(TodayView.serializer(), view))
        tmp.renameTo(cache)
        return view
    }

    fun clear() {
        cache.delete()
    }
}
