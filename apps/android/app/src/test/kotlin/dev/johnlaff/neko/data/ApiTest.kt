package dev.johnlaff.neko.data

import java.io.File
import java.io.InterruptedIOException
import java.nio.file.Files
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

/** Mia answers after several model calls; the app must wait for her longer than for a screen. */
class ApiTest {
    private val server = MockWebServer()
    private val dir: File = Files.createTempDirectory("neko-api").toFile()

    /** A client as impatient as OkHttp's default, scaled down so the test runs fast. */
    private val client = OkHttpClient.Builder().readTimeout(200, TimeUnit.MILLISECONDS).build()

    private fun slow(body: String) =
        MockResponse.Builder().code(200).body(body).headersDelay(600, TimeUnit.MILLISECONDS).build()

    private fun api() = Api(server.url("/").toString().trimEnd('/'), client, CookieStore(SealedFile(File(dir, "c"), lazyOf(null))))

    @Before fun start() = server.start()

    @After fun stop() {
        server.close()
        dir.deleteRecursively()
    }

    @Test fun aSlowMiaAnswerStillArrives() = runBlocking {
        server.enqueue(slow("""{"texto":"Oi","valores":{},"modelo":"claude-haiku-5-5"}"""))
        val reply = api().askMia(MiaAsk("Oi?", emptyList(), emptyMap()))
        assertEquals("Oi", reply.texto)
    }

    @Test fun aScreenReadKeepsTheShortTimeout() {
        server.enqueue(slow("""{"email":"dono@example.com"}"""))
        assertThrows(InterruptedIOException::class.java) { runBlocking { api().me() } }
    }
}
