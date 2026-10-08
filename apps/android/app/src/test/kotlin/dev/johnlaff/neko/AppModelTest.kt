package dev.johnlaff.neko

import dev.johnlaff.neko.data.Neko
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.ui.AppModel
import dev.johnlaff.neko.ui.ReadError
import dev.johnlaff.neko.ui.Session
import java.io.File
import java.nio.file.Files
import java.util.Collections
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The app's state against a local Worker: what each screen shows when a read works, fails offline,
 * hits a changed sheet or a lost session. The answers are the contract fixtures.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AppModelTest {
    private val server = MockWebServer()
    private val dir: File = Files.createTempDirectory("neko").toFile()
    private val asked: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val todayChanges: MutableList<TodayView?> = Collections.synchronizedList(mutableListOf())

    /** Path → answer; anything missing is a 404. */
    private val answers = mutableMapOf<String, MockResponse>()

    private fun ok(fixture: String) = MockResponse(code = 200, body = File("src/test/resources/$fixture").readText())

    private fun json(code: Int, body: String) = MockResponse(code = code, body = body)

    @Before fun start() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.url.encodedPath.removePrefix("/api")
                asked += path
                return answers[path] ?: MockResponse(code = 404, body = """{"error":"not-found"}""")
            }
        }
        server.start()
        answers["/me"] = json(200, """{"email":"dono@example.com"}""")
        answers["/today"] = ok("today.json")
        answers["/invoices"] = ok("invoices.json")
        answers["/months"] = ok("months.json")
        answers["/history"] = json(200, """{"points":[],"delta":0}""")
    }

    @After fun stop() {
        server.close()
        Dispatchers.resetMain()
        dir.deleteRecursively()
    }

    private fun neko() = Neko.create(dir, server.url("/").toString().trimEnd('/'), "test", lazyOf(null))

    private fun model(neko: Neko = neko()) = AppModel(neko) { todayChanges += it }

    private fun until(what: String, check: () -> Boolean) = runBlocking {
        runCatching { withTimeout(5_000) { while (!check()) delay(10) } }
            .onFailure { throw AssertionError("never happened: $what (asked: $asked)") }
    }

    @Test fun signedInReadsHojeThenFaturasAndMesInTheBackground() {
        val m = model()
        until("Hoje read") { m.today.value.view != null }
        until("Faturas and Mês prefetched") { m.invoices.value.view != null && m.months.value.view != null }
        assertEquals(Session.SignedIn, m.session.value)
        assertEquals(1, asked.count { it == "/invoices" })
        // The widget and the shortcut follow the new Hoje.
        assertNotNull(todayChanges.single())
    }

    @Test fun theNextStartOpensWithTheLastReadingsEvenOffline() {
        val first = model()
        until("prefetched") { first.invoices.value.view != null && first.months.value.view != null }
        server.close()

        val again = model(neko())
        until("cached Hoje") { again.today.value.view != null }
        until("offline noticed") { again.today.value.error == ReadError.Offline }
        assertEquals(Session.SignedIn, again.session.value)
        assertNotNull(again.invoices.value.view)
        assertNotNull(again.months.value.view)
    }

    @Test fun aChangedSheetSaysSoAndKeepsNothingMadeUp() {
        answers["/today"] = json(422, """{"error":"sheet-structure","message":"A coluna Saldo sumiu."}""")
        val m = model()
        until("error") { m.today.value.error != null }
        assertEquals(ReadError.SheetStructure, m.today.value.error)
        assertEquals("A coluna Saldo sumiu.", m.today.value.detail)
        assertNull(m.today.value.view)
    }

    @Test fun aLostSessionSignsOutAndForgetsEveryReading() {
        val m = model()
        until("prefetched") { m.invoices.value.view != null }
        answers["/invoices"] = json(401, """{"error":"unauthorized"}""")
        m.refresh(dev.johnlaff.neko.ui.Tab.Faturas)
        until("signed out") { m.session.value == Session.SignedOut }
        assertNull(m.today.value.view)
        assertNull(m.invoices.value.view)
        assertNull(todayChanges.last())
        // Nothing of the old account opens on the next start.
        val again = model(neko())
        until("checked") { again.session.value != Session.Checking }
        assertNull(again.today.value.view)
        assertFalse(File(dir, "today.json").exists())
    }

    @Test fun noAccountMeansTheLoginScreen() {
        answers["/me"] = json(200, "{}")
        val m = model()
        until("checked") { m.session.value != Session.Checking }
        assertEquals(Session.SignedOut, m.session.value)
        assertTrue(asked.none { it == "/today" })
    }
}
