package dev.johnlaff.neko.data

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * Keeps the Worker's cookies (the session and the short-lived passkey challenge) in a sealed
 * private file outside backups, so the app stays signed in like the site does. Expired cookies are
 * dropped on every write.
 */
class CookieStore(private val file: SealedFile) : CookieJar {
    private val lock = Any()
    /** Read on the first request (always on OkHttp's thread), not when the app starts. */
    private var loaded = false
    private var cookieList: List<Cookie> = emptyList()
    private var cookies: List<Cookie>
        get() {
            if (!loaded) {
                cookieList = load()
                loaded = true
            }
            return cookieList
        }
        set(value) {
            cookieList = value
            loaded = true
        }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        synchronized(lock) {
            val now = System.currentTimeMillis()
            val replaced = this.cookies.filterNot { old ->
                cookies.any { it.name == old.name && it.domain == old.domain && it.path == old.path }
            }
            this.cookies = (replaced + cookies).filter { it.expiresAt > now }
            persist()
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> = synchronized(lock) {
        val now = System.currentTimeMillis()
        cookies.filter { it.expiresAt > now && it.matches(url) }
    }

    fun clear() = synchronized(lock) {
        cookies = emptyList()
        file.delete()
    }

    private fun persist() {
        val lines = cookies.filter { it.persistent }.joinToString("\n") { "${it.domain}\t$it" }
        file.write(lines)
    }

    private fun load(): List<Cookie> {
        val text = file.read() ?: return emptyList()
        return text.lines().mapNotNull { line ->
            val (domain, header) = line.split('\t', limit = 2).takeIf { it.size == 2 } ?: return@mapNotNull null
            val url = HttpUrl.Builder().scheme("https").host(domain).build()
            Cookie.parse(url, header)
        }
    }
}
