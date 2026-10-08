package dev.johnlaff.neko

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
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
    @Test fun hojeMarco() = shot("hoje-marco-dark", night = true) {
        val h = view.habit!!
        val reached = h.copy(streak = 21, milestone = 21, editedToday = true, week = h.week.mapIndexed { i, d -> if (i == 1) d.copy(state = "edited") else d })
        HojeScreen(TodayState(view.copy(habit = reached)), {}, {})
    }

    private fun <T> read(file: String, s: kotlinx.serialization.KSerializer<T>): T =
        json.decodeFromString(s, File("src/test/resources/$file").readText())

    private val invoices = read("invoices.json", InvoicesView.serializer())
    private val months = read("months.json", MonthsView.serializer())
    private val ajustes = read("ajustes.json", AjustesView.serializer())

    @Test fun faturasDark() = shot("faturas-dark", night = true) { FaturasScreen(ScreenState(invoices), {}, {}) }

    @Test fun faturasLight() = shot("faturas-light", night = false) { FaturasScreen(ScreenState(invoices), {}, {}) }

    @Test fun mesDark() = shot("mes-dark", night = true) { MesScreen(ScreenState(months), Fakes.history) {} }

    @Test fun mesReserva() = shot("mes-reserva-dark", night = true) {
        dev.johnlaff.neko.ui.ReservePanel(months.reserve!!, months.years.lastOrNull())
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

    @Test fun loadingDark() = shot("carregando-dark", night = true) { HojeScreen(TodayState(loading = true), {}, {}) }

    @Test fun lockLight() = shot("lock-light", night = false) { LockScreen {} }

    @Test fun loginDark() = shot("login-dark", night = true) { LoginScreen {} }

    private fun shot(name: String, night: Boolean, content: @androidx.compose.runtime.Composable () -> Unit) {
        // Each screen shows its own first-time tip, whatever the test before it showed.
        dev.johnlaff.neko.ui.Hints.reset(org.robolectric.RuntimeEnvironment.getApplication())
        org.robolectric.RuntimeEnvironment.setQualifiers(if (night) "+night" else "+notnight")
        // The app's window paints the background; a bare composition here would be transparent.
        compose.setContent {
            NekoTheme { Box(Modifier.background(MaterialTheme.colorScheme.background)) { content() } }
        }
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }
}
