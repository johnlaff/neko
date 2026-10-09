package dev.johnlaff.neko

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToNode
import com.github.takahirom.roborazzi.captureRoboImage
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.data.AjustesView
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.data.MonthsView
import dev.johnlaff.neko.ui.AjustesScreen
import dev.johnlaff.neko.ui.RemindersSwitch
import dev.johnlaff.neko.ui.LockScreen
import dev.johnlaff.neko.ui.LockSwitch
import dev.johnlaff.neko.ui.FaturasScreen
import dev.johnlaff.neko.ui.HojeScreen
import dev.johnlaff.neko.ui.MesScreen
import dev.johnlaff.neko.ui.SaveState
import dev.johnlaff.neko.ui.Simulator
import dev.johnlaff.neko.ui.ScreenState
import dev.johnlaff.neko.ui.LoginScreen
import dev.johnlaff.neko.ui.NekoTheme
import dev.johnlaff.neko.ui.TodayState
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.RobolectricTestRunner

/**
 * Screens drawn from the contract fixture, light and dark. `./gradlew recordRoborazziDebug`
 * writes them to app/screenshots; `verifyRoborazziDebug` compares against those files.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class ScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val view: TodayView = json.decodeFromString(File("src/test/resources/today.json").readText())

    @Test fun hojeDark() = shot("hoje-dark", night = true) { HojeScreen(TodayState(view), {}, {}) }

    @Test fun hojeLight() = shot("hoje-light", night = false) { HojeScreen(TodayState(view), {}, {}) }

    /** The day the run reaches 21: the week's marks and the one card that celebrates it. */
    @Test fun hojeResumo() = shot("hoje-resumo-dark", night = true) { dev.johnlaff.neko.ui.RecapPanel(view.recap!!) }

    @Test fun hojeMarco() = shot("hoje-marco-dark", night = true) {
        val h = view.habit!!
        val reached = h.copy(streak = 21, milestone = 21, editedToday = true, week = h.week.mapIndexed { i, d -> if (i == 1) d.copy(state = "edited") else d })
        HojeScreen(TodayState(view.copy(habit = reached)), {}, {})
    }

    /** The day the run passes its best before: the same card, a new best instead of a mark. */
    @Test fun hojeRecorde() = shot("hoje-recorde-light", night = false) {
        val h = view.habit!!
        HojeScreen(TodayState(view.copy(habit = h.copy(streak = 11, best = 11, milestone = null, record = 10, editedToday = true))), {}, {})
    }

    private fun <T> read(file: String, s: kotlinx.serialization.KSerializer<T>): T =
        json.decodeFromString(s, File("src/test/resources/$file").readText())

    private val invoices = read("invoices.json", InvoicesView.serializer())
    private val months = read("months.json", MonthsView.serializer())
    private val ajustes = read("ajustes.json", AjustesView.serializer())

    /** The fixture's invented cards renamed to banks the app knows, to show their marks. */
    private fun banked(file: String) =
        File("src/test/resources/$file").readText().replace("Cartão Azul", "Nubank").replace("Cartão Verde", "Itaú")

    @Test fun logosFaturasLight() = shot("logos-faturas-light", night = false, scrollTo = "Outros cartões") {
        FaturasScreen(ScreenState(json.decodeFromString(InvoicesView.serializer(), banked("invoices.json"))), {}, {})
    }

    @Test fun logosMesDark() = shot("logos-mes-dark", night = true, scrollTo = "Para onde foi") {
        MesScreen(ScreenState(json.decodeFromString(MonthsView.serializer(), banked("months.json"))), null) {}
    }

    @Test fun faturasDark() = shot("faturas-dark", night = true) { FaturasScreen(ScreenState(invoices), {}, {}) }

    @Test fun faturasLight() = shot("faturas-light", night = false) { FaturasScreen(ScreenState(invoices), {}, {}) }

    @Test fun mesDark() = shot("mes-dark", night = true) { MesScreen(ScreenState(months), Fakes.history) {} }

    @Test fun mesReserva() = shot("mes-reserva-dark", night = true) {
        dev.johnlaff.neko.ui.ReservePanel(months.reserve!!, months.years.lastOrNull())
    }

    /** A closed month keeps its wins: September 2025 ended in the blue and first covered a month. */
    @Test fun mesFechado() = shot("mes-fechado-light", night = false) {
        MesScreen(ScreenState(months.copy(current = "2025-09"))) {}
    }

    /** A destination of "Para onde foi" opened: its last six months. */
    @Test fun mesDestino() = shot("mes-destino-light", night = false) {
        dev.johnlaff.neko.ui.Trend(months.months.first { it.key == "2025-09" }.outflows.first().trend)
    }

    @Test fun mesLight() = shot("mes-light", night = false) { MesScreen(ScreenState(months), Fakes.history) {} }

    @Test fun simularDark() = shot("simular-dark", night = true) {
        Simulator(view.canSpend!!, Fakes.simulate, startTyped = "600,00", startCount = 3)
    }

    @Test fun simularLight() = shot("simular-light", night = false) {
        HojeScreen(TodayState(view), {}, {}, Fakes.simulate, simulatorOpen = true)
    }

    @Test fun ajustesDark() = shot("ajustes-dark", night = true) {
        AjustesScreen(ScreenState(ajustes), SaveState.Saved, {}, {}, {}, RemindersSwitch(on = true), Fakes.devices, LockSwitch(on = true))
    }

    // The Diário previsto (specs/005-lancamentos, Fase 3): the value with the bank's suggestion,
    // the review every 3 months, and the card's cycle when it is off.
    @Test fun previstoAjustesDark() = shot("previsto-ajustes-dark", night = true) {
        dev.johnlaff.neko.ui.Panel { dev.johnlaff.neko.ui.PrevistoForm(ajustes.previsto!!.copy(on = false), false, {}, {}) }
    }

    @Test fun previstoHojeLight() = shot("previsto-hoje-light", night = false, scrollTo = "A cada 3 meses") {
        HojeScreen(TodayState(view), {}, {}, launcher = Fakes.launcher)
    }

    @Test fun cicloHojeDark() = shot("ciclo-hoje-dark", night = true) {
        val cycle = view.canSpend!!.copy(mode = "cycle", pace = "over", perDay = -2_000, overBy = 30_000, daysBehind = 0)
        HojeScreen(TodayState(view.copy(canSpend = cycle, previsto = null)), {}, {})
    }

    @Test fun proximosDark() = shot("proximos-dark", night = true, scrollTo = "Próximos 7 dias") {
        HojeScreen(TodayState(view), {}, {})
    }

    // The bank's parts sit at the end of each screen: scrolled there, as the owner would.
    @Test fun bancoHojeLight() = shot("banco-hoje-light", night = false, scrollTo = "Para lançar") {
        HojeScreen(TodayState(view), {}, {}, launcher = Fakes.launcher)
    }

    @Test fun saldoHojeDark() = shot("saldo-hoje-dark", night = true, scrollTo = "Para lançar") {
        HojeScreen(TodayState(view.copy(queue = emptyList())), {}, {}, launcher = Fakes.launcher)
    }

    @Test fun lancarDark() = shot("lancar-dark", night = true) {
        HojeScreen(TodayState(view.copy(entryCards = listOf("Cartão Azul"))), {}, {}, launcher = Fakes.launcher, launchOpen = true)
    }

    @Test fun miaHojeLight() = shot("mia-hoje-light", night = false, scrollTo = "Perguntar à Mia") {
        HojeScreen(
            TodayState(view), {}, {},
            mia = dev.johnlaff.neko.data.MiaStatus(ligada = true),
            askMia = { error("no network in screenshots") },
            miaOpen = true,
            miaTalk = listOf(Fakes.miaExchange),
        )
    }

    @Test fun miaVaziaDark() = shot("mia-vazia-dark", night = true, scrollTo = "Perguntar à Mia") {
        HojeScreen(
            TodayState(view), {}, {},
            mia = dev.johnlaff.neko.data.MiaStatus(ligada = true),
            askMia = { error("no network in screenshots") },
            miaOpen = true,
        )
    }

    @Test fun bancoFaturasDark() = shot("banco-faturas-dark", night = true, scrollTo = "Faturas no banco") {
        FaturasScreen(ScreenState(invoices), {}, {})
    }

    @Test fun bancoAjustesLight() = shot("banco-ajustes-light", night = false, scrollTo = "Bancos") {
        AjustesScreen(
            ScreenState(ajustes), SaveState.Saved, {}, {}, {}, RemindersSwitch(on = true), Fakes.devices,
            LockSwitch(on = true), Fakes.banks,
        )
    }

    @Test fun loadingDark() = shot("carregando-dark", night = true) { HojeScreen(TodayState(loading = true), {}, {}) }

    @Test fun lockLight() = shot("lock-light", night = false) { LockScreen {} }

    @Test fun loginDark() = shot("login-dark", night = true) { LoginScreen {} }

    private fun shot(
        name: String,
        night: Boolean,
        scrollTo: String? = null,
        content: @androidx.compose.runtime.Composable () -> Unit,
    ) {
        // Each screen shows its own first-time tip, whatever the test before it showed.
        dev.johnlaff.neko.ui.Hints.reset(org.robolectric.RuntimeEnvironment.getApplication())
        org.robolectric.RuntimeEnvironment.setQualifiers(if (night) "+night" else "+notnight")
        // The app's window paints the background; a bare composition here would be transparent.
        compose.setContent {
            NekoTheme { Box(Modifier.background(MaterialTheme.colorScheme.background)) { content() } }
        }
        // The screen's list, not a row that slides sideways inside it (Mia's suggestions).
        scrollTo?.let { compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(it)) }
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }
}
