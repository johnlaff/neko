package dev.johnlaff.neko

import androidx.compose.ui.test.junit4.createComposeRule
import dev.johnlaff.neko.data.AjustesView
import dev.johnlaff.neko.data.BuyGroup
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.data.MonthsView
import dev.johnlaff.neko.data.OtherBill
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.ui.AjustesScreen
import dev.johnlaff.neko.ui.RemindersSwitch
import dev.johnlaff.neko.ui.FaturasScreen
import dev.johnlaff.neko.ui.HojeScreen
import dev.johnlaff.neko.ui.MesScreen
import dev.johnlaff.neko.ui.SaveState
import dev.johnlaff.neko.ui.ScreenState
import dev.johnlaff.neko.ui.Tab
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The invented fixtures pushed to what real sheets have (long card names, many cards, every chip)
 * on a small phone with large text, the whole list and the dock in view. Long names hid a card in
 * the first release; these prints are where that shows before a phone ever sees it.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "xxhdpi", application = android.app.Application::class)
class StressScreensTest {
    @get:Rule val compose = createComposeRule()

    private fun res(name: String) = File("src/test/resources/$name")

    private val today = readJson(res("today.json"), TodayView.serializer())

    private val invoices = readJson(res("invoices.json"), InvoicesView.serializer()).let { v ->
        v.copy(
            usual = v.usual?.copy(card = "Bradesco Visa Infinite Prime"),
            buyToday = listOf(
                BuyGroup(listOf("Bradesco Visa Infinite", "Inter Black", "Mercado Pago"), 36, "2026-11-12", "2026-11-06", true),
                BuyGroup(listOf("Amazon", "Itau Personnalité"), 34, "2026-11-10", "2026-11-04", true),
                BuyGroup(listOf("Nubank Ultravioleta"), 19, "2026-10-26", "2026-10-20", false),
            ),
            others = v.others + OtherBill("Bradesco Elo Nanquim da Gio", 79_33, "2026-11-12", others = true, reimbursed = true),
            empty = listOf("Itau", "Mercado Pago", "BB", "Bradesco", "Inter", "Nubank"),
        )
    }

    private val months = readJson(res("months.json"), MonthsView.serializer()).let { v ->
        v.copy(
            months = v.months.map { m ->
                if (m.key != v.current) m
                else m.copy(
                    outflows = m.outflows.mapIndexed { i, o ->
                        if (i == 1) o.copy(label = "Financiamento Carro Honda Civic 13/36", others = true) else o
                    },
                )
            },
        )
    }

    private val ajustes = readJson(res("ajustes.json"), AjustesView.serializer())

    private fun path(name: String) = "screenshots/stress/$name.png"

    @Test fun hoje() = compose.shot(path("hoje"), night = true, Device.SmallLargeText, Tab.Hoje) {
        HojeScreen(ScreenState(today), {}, {})
    }

    @Test fun faturas() = compose.shot(path("faturas"), night = true, Device.SmallLargeText, Tab.Faturas) {
        FaturasScreen(ScreenState(invoices), {}, {})
    }

    @Test fun mes() = compose.shot(path("mes"), night = false, Device.SmallLargeText, Tab.Mes) {
        MesScreen(ScreenState(months)) {}
    }

    @Test fun ajustes() = compose.shot(path("ajustes"), night = false, Device.SmallLargeText, Tab.Ajustes) {
        AjustesScreen(ScreenState(ajustes), SaveState.Saved, {}, {}, {}, RemindersSwitch(on = true))
    }
}
