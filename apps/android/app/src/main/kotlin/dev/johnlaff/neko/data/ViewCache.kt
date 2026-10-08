package dev.johnlaff.neko.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer

/**
 * A screen's last reading, sealed on disk: the screen opens with it at once (or offline) while a
 * fresh read is on the way. Every read and write runs off the main thread.
 */
class ViewCache<T>(private val file: SealedFile, private val serializer: KSerializer<T>) {
    suspend fun read(): T? = withContext(Dispatchers.IO) {
        file.read()?.let { runCatching { json.decodeFromString(serializer, it) }.getOrNull() }
    }

    /** For the widget, which already runs off the main thread. */
    fun readNow(): T? = file.read()?.let { runCatching { json.decodeFromString(serializer, it) }.getOrNull() }

    suspend fun write(view: T) = withContext(Dispatchers.IO) { file.write(json.encodeToString(serializer, view)) }

    fun clear() = file.delete()
}

/** The other screens' last readings, cleared together on sign-out. */
class Caches(
    val invoices: ViewCache<InvoicesView>,
    val months: ViewCache<MonthsView>,
    val ajustes: ViewCache<AjustesView>,
    val history: ViewCache<HistoryView>,
) {
    fun clear() {
        invoices.clear()
        months.clear()
        ajustes.clear()
        history.clear()
    }
}
