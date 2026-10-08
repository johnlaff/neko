package dev.johnlaff.neko

import androidx.compose.ui.test.junit4.v2.createComposeRule
import dev.johnlaff.neko.data.AjustesView
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.data.MonthsView
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.ui.AjustesScreen
import dev.johnlaff.neko.ui.FaturasScreen
import dev.johnlaff.neko.ui.HojeScreen
import dev.johnlaff.neko.ui.MesScreen
import dev.johnlaff.neko.ui.SaveState
import dev.johnlaff.neko.ui.ScreenState
import dev.johnlaff.neko.ui.Tab
import java.io.File
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The screens with the real sheet's numbers, for a look before release. The views hold the owner's
 * finances, so they and the prints stay outside the repository: the real-sheet test in
 * apps/neko writes the views to NEKO_ANDROID_VIEWS, and this draws them into NEKO_ANDROID_PRINTS.
 * Skipped when the views are not there, as in CI.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "xxhdpi", application = android.app.Application::class)
class RealScreensTest {
    @get:Rule val compose = createComposeRule()

    private val views = System.getProperty("neko.android.views")?.takeIf { it.isNotBlank() }?.let(::File)
    private val prints = System.getProperty("neko.android.prints")?.takeIf { it.isNotBlank() } ?: "build/real-prints"

    private fun <T> view(file: String, s: kotlinx.serialization.KSerializer<T>): T {
        val f = views?.resolve(file)
        assumeTrue("Real views not available", f?.exists() == true)
        return readJson(f!!, s)
    }

    private fun path(name: String, device: Device) = "$prints/$name-${device.name}.png"

    private fun hoje(device: Device) {
        val v = view("today.json", TodayView.serializer())
        compose.shot(path("hoje", device), night = true, device, Tab.Hoje) { HojeScreen(ScreenState(v), {}, {}) }
    }

    private fun faturas(device: Device) {
        val v = view("invoices.json", InvoicesView.serializer())
        compose.shot(path("faturas", device), night = true, device, Tab.Faturas) { FaturasScreen(ScreenState(v), {}, {}) }
    }

    private fun mes(device: Device) {
        val v = view("months.json", MonthsView.serializer())
        compose.shot(path("mes", device), night = true, device, Tab.Mes) { MesScreen(ScreenState(v)) {} }
    }

    private fun ajustes(device: Device) {
        val v = view("ajustes.json", AjustesView.serializer())
        compose.shot(path("ajustes", device), night = true, device, Tab.Ajustes) {
            AjustesScreen(ScreenState(v), SaveState.Idle, {}, {}, {})
        }
    }

    @Test fun hojePhone() = hoje(Device.Phone)
    @Test fun hojeSmall() = hoje(Device.SmallLargeText)
    @Test fun faturasPhone() = faturas(Device.Phone)
    @Test fun faturasSmall() = faturas(Device.SmallLargeText)
    @Test fun mesPhone() = mes(Device.Phone)
    @Test fun mesSmall() = mes(Device.SmallLargeText)
    @Test fun ajustesPhone() = ajustes(Device.Phone)
    @Test fun ajustesSmall() = ajustes(Device.SmallLargeText)
}
