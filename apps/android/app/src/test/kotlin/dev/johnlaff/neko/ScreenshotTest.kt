package dev.johnlaff.neko

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.click
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.performScrollToNode
import com.github.takahirom.roborazzi.captureRoboImage
import dev.johnlaff.neko.data.Saving
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.data.AjustesView
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.data.MonthsView
import dev.johnlaff.neko.data.StatementAnswer
import dev.johnlaff.neko.data.StatementLine
import dev.johnlaff.neko.ui.AjustesScreen
import dev.johnlaff.neko.ui.PurchasesSwitch
import dev.johnlaff.neko.data.PhoneTrust
import dev.johnlaff.neko.ui.RemindersSwitch
import dev.johnlaff.neko.ui.LockScreen
import dev.johnlaff.neko.ui.LockSwitch
import dev.johnlaff.neko.ui.FaturasScreen
import dev.johnlaff.neko.ui.HojeScreen
import dev.johnlaff.neko.ui.MesScreen
import dev.johnlaff.neko.ui.MiaChat
import dev.johnlaff.neko.ui.MiaScreen
import dev.johnlaff.neko.ui.SaveState
import dev.johnlaff.neko.ui.StatementRead
import dev.johnlaff.neko.ui.SimularScreen
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

    /** Payday: what saving it all does to the reserve's steps. */
    @Test fun hojeGuardar() = shot("hoje-guardar-dark", night = true, scrollTo = "Dia de guardar") {
        HojeScreen(TodayState(view), {}, {})
    }

    /** The day the run reaches 21: the week's marks and the one card that celebrates it. */
    @Test fun hojeMarco() = shot("hoje-marco-dark", night = true, scrollTo = "Planilha em dia · 21 dias") {
        val h = view.habit!!
        val reached = h.copy(streak = 21, milestone = 21, next = 66, editedToday = true, week = h.week.mapIndexed { i, d -> if (i == 1) d.copy(state = "edited") else d })
        HojeScreen(TodayState(view.copy(habit = reached)), {}, {})
    }

    /** Yesterday went without a change: the run waits for today's edit, and Hoje says so. */
    @Test fun hojeEmRisco() = shot("hoje-em-risco-light", night = false, scrollTo = "Sequência de 12 dias") {
        val h = view.habit!!
        val waiting = h.copy(atRisk = true, milestone = null, record = null, week = h.week.mapIndexed { i, d -> if (i == 0) d.copy(state = "missed") else d })
        HojeScreen(TodayState(view.copy(habit = waiting)), {}, {})
    }

    /** The day the run passes its best before: the same card, a new best instead of a mark. */
    @Test fun hojeRecorde() = shot("hoje-recorde-light", night = false, scrollTo = "Planilha em dia · 11 dias") {
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

    // With the bank's bill PDF option under the cards, after a read that brought two lines.
    @Test fun logosFaturasLight() = shot("logos-faturas-light", night = false, scrollTo = "Cartões") {
        val read = StatementAnswer(
            read = true, due = "2026-10-12", cards = 2, lines = 23,
            added = listOf(StatementLine("Nubank", "AJUSTE A CREDITO", -15990), StatementLine("Itaú", "PET SHOP CENTRO", 7566)),
        )
        FaturasScreen(
            ScreenState(json.decodeFromString(InvoicesView.serializer(), banked("invoices.json"))), {}, {},
            statement = StatementRead(read),
        )
    }

    @Test fun logosMesDark() = shot("logos-mes-dark", night = true, scrollTo = "Para onde foi") {
        MesScreen(ScreenState(json.decodeFromString(MonthsView.serializer(), banked("months.json"))), null) {}
    }

    @Test fun faturasDark() = shot("faturas-dark", night = true) { FaturasScreen(ScreenState(invoices), {}, {}) }

    @Test fun faturasLight() = shot("faturas-light", night = false) { FaturasScreen(ScreenState(invoices), {}, {}) }

    @Test fun mesDark() = shot("mes-dark", night = true) { MesScreen(ScreenState(months), Fakes.history) {} }

    /** On the way, "Como funciona" opened: the steps, the cost of living and the method's rule. */
    @Test fun mesReserva() = shot("mes-reserva-dark", night = true, tap = "Como funciona") {
        dev.johnlaff.neko.ui.ReservePanel(months.reserve!!, months.steps!!, months.years.lastOrNull())
    }

    /** Nothing kept yet: the first step and where the panel reads what is kept. */
    @Test fun mesReservaVazia() = shot("mes-reserva-vazia-light", night = false) {
        val s = months.steps!!
        val first = s.steps.first()
        dev.johnlaff.neko.ui.ReservePanel(
            months.reserve!!.copy(kept = 0, coveredTenths = 0),
            s.copy(reached = 0, next = first, missing = first.amount),
            null,
        )
    }

    /** Past the method's 6 months: the meter climbs to 12 and the line under it says how far. */
    @Test fun mesReservaSeis() = shot("mes-reserva-seis-light", night = false) {
        val s = months.steps!!
        val six = s.steps[s.steps.size - 2]
        val twelve = s.steps.last()
        dev.johnlaff.neko.ui.ReservePanel(
            months.reserve!!.copy(kept = six.amount),
            s.copy(reached = s.steps.size - 1, next = twelve, missing = twelve.amount - six.amount),
            null,
        )
    }

    /** "Como funciona" is pulled up over the gap above it: a touch near its top edge still opens it. */
    @Test fun reservaToggleTop() {
        org.robolectric.RuntimeEnvironment.setQualifiers("+notnight")
        compose.setContent {
            NekoTheme { dev.johnlaff.neko.ui.ReservePanel(months.reserve!!, months.steps!!, null) }
        }
        compose.onNodeWithText(dev.johnlaff.neko.ui.Learn.RESERVE_MORE)
            .performTouchInput { click(androidx.compose.ui.geometry.Offset(centerX, 2f)) }
        compose.onNodeWithText(dev.johnlaff.neko.ui.Learn.RESERVE_RULE).assertExists()
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

    // No line typed yet: nothing to compare with.
    @Test fun simularDark() = shot("simular-dark", night = true) {
        // Opened, before any what-if: the bills leave room under the ceiling, so it is no best case.
        SimularScreen(
            Fakes.askScenarios, {},
            start = Fakes.scenario.copy(
                effect = null, effects = emptyList(), full = emptyList(),
                saving = Saving("2026-10-05", 5_600_00, 7_600_00, "2026-12-31", 510_48),
            ),
        )
    }

    /** Scrolled down to the what-ifs: the answer stays in one line under the bar. */
    @Test fun simularPeekDark() = shot("simular-peek-dark", night = true, scrollTo = "Todo dia 20, 2 meses seguidos.") {
        SimularScreen(Fakes.askScenarios, {}, start = Fakes.scenario, startRows = Fakes.scenarioRows)
    }

    @Test fun simularLight() = shot("simular-light", night = false, scrollTo = "E se…") {
        SimularScreen(Fakes.askScenarios, {}, start = Fakes.scenario, startRows = Fakes.scenarioRows)
    }

    @Test fun simularMesesDark() = shot("simular-meses-dark", night = true, tap = "Mês a mês") {
        SimularScreen(Fakes.askScenarios, {}, start = Fakes.scenario, startRows = Fakes.scenarioRows)
    }

    @Test fun ajustesDark() = shot("ajustes-dark", night = true) {
        AjustesScreen(ScreenState(ajustes.copy(phone = listOf(PhoneTrust("Bradesco", judged = 3, matched = 3), PhoneTrust("Inter")))), SaveState.Saved, {}, {}, {}, RemindersSwitch(on = true), Fakes.devices, LockSwitch(on = true), launcher = Fakes.launcher, purchases = PurchasesSwitch(on = true, last = "R$ 45,90 em Livraria Central"))
    }

    // The Diário previsto (specs/005-lancamentos, Fase 3): the value with the bank's suggestion,
    // the review every 3 months, and the card's cycle when it is off.
    @Test fun previstoAjustesDark() = shot("previsto-ajustes-dark", night = true) {
        dev.johnlaff.neko.ui.Panel { dev.johnlaff.neko.ui.PrevistoForm(ajustes.previsto!!.copy(on = false), false, {}) {} }
    }

    @Test fun previstoHojeLight() = shot("previsto-hoje-light", night = false, scrollTo = "A cada 3 meses") {
        HojeScreen(TodayState(view), {}, {}, launcher = Fakes.launcher)
    }

    @Test fun cicloHojeDark() = shot("ciclo-hoje-dark", night = true) {
        // The open bill R$ 300 past its plan: the arc full, the figure in red.
        val plan = view.canSpend!!.budget
        val cycle = view.canSpend!!.copy(
            mode = "cycle", pace = "over", accumulated = plan + 30_000, left = 0, overBy = 30_000,
            paceGap = -(plan + 30_000 - view.canSpend!!.paceExpected), budgetSource = "configured",
        )
        HojeScreen(TodayState(view.copy(canSpend = cycle, previsto = null)), {}, {})
    }

    @Test fun tetoHojeLight() = shot("teto-hoje-light", night = false) {
        // The month's ceiling: next month's bills and this month's Pix under it.
        val teto = view.canSpend!!.copy(
            mode = "cards", pace = "on-pace", budget = 250_000, budgetSource = "configured",
            accumulated = 60_000, bills = 45_000, pix = 15_000, left = 190_000, overBy = 0, used = 0, due = "2026-11-30",
        )
        HojeScreen(TodayState(view.copy(canSpend = teto, previsto = null)), {}, {})
    }

    @Test fun proximosDark() = shot("proximos-dark", night = true, scrollTo = "Próximos 7 dias") {
        HojeScreen(TodayState(view), {}, {})
    }

    // The bank's parts, scrolled to as the owner would.
    @Test fun bancoHojeLight() = shot("banco-hoje-light", night = false, scrollTo = "Para lançar") {
        HojeScreen(TodayState(view), {}, {}, launcher = Fakes.launcher)
    }

    // Para lançar: one item at a time, the count and the bar over it, the edges of the rest under it.
    @Test fun filaLight() {
        org.robolectric.RuntimeEnvironment.setQualifiers("+h2000dp")
        shot("fila-light", night = false) {
            androidx.compose.foundation.layout.Column(Modifier.padding(16.dp)) {
                dev.johnlaff.neko.ui.ParaLancar(view, Fakes.launcher) {}
            }
        }
    }

    // Someone else's card: the bill and her payback together, or only the bill.
    @Test fun filaEscolhaDark() = shot("fila-escolha-dark", night = true) {
        androidx.compose.foundation.layout.Column(Modifier.padding(16.dp)) {
            dev.johnlaff.neko.ui.ParaLancar(view.copy(queue = view.queue.orEmpty().filter { it.options.size > 1 }), Fakes.launcher) {}
        }
    }

    // What Mia proposed in a conversation: a new line like any other, saying where it came from.
    @Test fun filaMiaDark() = shot("fila-mia-dark", night = true) {
        val item = view.queue!!.first { it.kind == "diario" }.copy(
            key = "mia:1", title = "Mercado", bank = emptyList(), note = "Veio da sua conversa com a Mia.",
        )
        androidx.compose.foundation.layout.Column(Modifier.padding(16.dp)) {
            dev.johnlaff.neko.ui.ParaLancar(view.copy(queue = listOf(item)), Fakes.launcher) {}
        }
    }

    @Test fun saldoHojeDark() = shot("saldo-hoje-dark", night = true, scrollTo = "Para lançar") {
        HojeScreen(TodayState(view.copy(queue = emptyList())), {}, {}, launcher = Fakes.launcher)
    }

    // A class the sheet planned and the bank has not paid yet: nothing to launch, the line named.
    @Test fun saldoEsperandoLight() = shot("saldo-esperando-light", night = false, scrollTo = "Para lançar") {
        val saldo = view.saldo!!.let {
            it.copy(
                bank = it.sheet + 23_200, diff = 23_200, draft = null,
                waiting = listOf(dev.johnlaff.neko.data.SaldoWaiting("2026-10-04", "saida", "Aulas de inglês", 23_200)),
            )
        }
        HojeScreen(TodayState(view.copy(queue = emptyList(), saldo = saldo)), {}, {}, launcher = Fakes.launcher)
    }

    @Test fun lancarDark() = shot("lancar-dark", night = true) {
        HojeScreen(TodayState(view.copy(entryCards = listOf("Cartão Azul"))), {}, {}, launcher = Fakes.launcher, launchOpen = true)
    }

    // Lançar com a Mia: the sentence above the fields it fills.
    @Test fun lancarMiaLight() = shot("lancar-mia-light", night = false) {
        HojeScreen(TodayState(view.copy(entryCards = listOf("Cartão Azul"))), {}, {}, launcher = Fakes.miaLauncher, launchOpen = true)
    }

    // Mia's own screen: a conversation, and the first look with the questions she answers well.
    @Test fun miaConversaLight() = shot("mia-conversa-light", night = false) {
        MiaScreen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true),
            { error("no network in screenshots") },
            MiaChat(listOf(Fakes.miaExchange)),
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    @Test fun miaVaziaDark() = shot("mia-vazia-dark", night = true) {
        MiaScreen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true),
            { error("no network in screenshots") },
            MiaChat(),
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    // Mia 2: answers with checked values and charts, the first look, and an answer on its way.
    @Test fun mia2ConversaDark() = shot("mia2-conversa-dark", night = true) {
        dev.johnlaff.neko.ui.Mia2Screen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true, versao = 2),
            Fakes.mia2Talk,
            Fakes.mia2Chat(),
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    @Test fun mia2ConversaLight() = shot("mia2-conversa-light", night = false) {
        dev.johnlaff.neko.ui.Mia2Screen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true, versao = 2),
            Fakes.mia2Talk,
            Fakes.mia2Chat(),
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    @Test fun mia2LinhaLight() = shot("mia2-linha-light", night = false) {
        dev.johnlaff.neko.ui.Mia2Screen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true, versao = 2),
            Fakes.mia2Talk,
            Fakes.mia2Chat().apply { turns = turns.drop(1) },
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    // Her routines: what she left by herself, where a question would be, ready to go on from.
    @Test fun mia2RotinaDark() = shot("mia2-rotina-dark", night = true) {
        dev.johnlaff.neko.ui.Mia2Screen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true, versao = 2),
            Fakes.mia2Talk,
            Fakes.mia2Rotina(),
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    @Test fun mia2FechamentoLight() = shot("mia2-fechamento-light", night = false) {
        dev.johnlaff.neko.ui.Mia2Screen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true, versao = 2),
            Fakes.mia2Talk,
            Fakes.mia2Rotina("mes"),
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    // A summary: one sentence, then her board of numbers. Typed and ready, Enviar reads in its ink.
    @Test fun mia2ResumoDark() = shot("mia2-resumo-dark", night = true) {
        dev.johnlaff.neko.ui.Mia2Screen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true, versao = 2),
            Fakes.mia2Talk,
            Fakes.mia2Resumo().apply { typed = "E a fatura de dezembro?" },
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    @Test fun mia2ResumoLight() = shot("mia2-resumo-light", night = false) {
        dev.johnlaff.neko.ui.Mia2Screen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true, versao = 2),
            Fakes.mia2Talk,
            Fakes.mia2Resumo(),
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    @Test fun mia2VaziaLight() = shot("mia2-vazia-light", night = false) {
        dev.johnlaff.neko.ui.Mia2Screen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true, versao = 2),
            Fakes.mia2Talk,
            dev.johnlaff.neko.ui.Mia2Chat(),
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    @Test fun mia2EsperandoDark() = shot("mia2-esperando-dark", night = true) {
        dev.johnlaff.neko.ui.Mia2Screen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true, versao = 2),
            Fakes.mia2Talk,
            dev.johnlaff.neko.ui.Mia2Chat().apply {
                turns = listOf(dev.johnlaff.neko.ui.Mia2Turno(0, "Quanto vem nas faturas de dezembro?", emptyList()))
                pending = 0
                status = "Lendo as faturas…"
            },
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    @Test fun mia2ParouLight() = shot("mia2-parou-light", night = false) {
        dev.johnlaff.neko.ui.Mia2Screen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true, versao = 2),
            Fakes.mia2Talk,
            dev.johnlaff.neko.ui.Mia2Chat().apply {
                turns = listOf(
                    dev.johnlaff.neko.ui.Mia2Turno(
                        0,
                        "Quanto ainda cabe este mês?",
                        listOf(dev.johnlaff.neko.ui.Mia2Texto("m1", "Ainda cabem **R$ 1.240,60** no teto até o dia 26, uns R$ 88 por di", null)),
                        "parou",
                    ),
                )
            },
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    @Test fun mia2ApagadaDark() = shot("mia2-apagada-dark", night = true) {
        dev.johnlaff.neko.ui.Mia2Screen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true, versao = 2),
            Fakes.mia2Talk,
            Fakes.mia2Chat().apply { clear() },
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    @Test fun mia2FalhouLight() = shot("mia2-falhou-light", night = false) {
        dev.johnlaff.neko.ui.Mia2Screen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true, versao = 2),
            Fakes.mia2Talk,
            dev.johnlaff.neko.ui.Mia2Chat().apply {
                turns = listOf(dev.johnlaff.neko.ui.Mia2Turno(0, "Quanto vem nas faturas de dezembro?", emptyList(), "falhou"))
            },
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
        )
    }

    // Mia's mark in the head of a tab, and her screen opened from it.
    @Test fun miaTopoDark() = shot("mia-topo-dark", night = true) {
        androidx.compose.runtime.CompositionLocalProvider(dev.johnlaff.neko.ui.LocalMia provides Fakes.miaEntry) {
            FaturasScreen(ScreenState(invoices), {}, {})
        }
    }

    @Test fun miaFaturasLight() = shot("mia-faturas-light", night = false) {
        MiaScreen(
            dev.johnlaff.neko.data.MiaStatus(ligada = true),
            { error("no network in screenshots") },
            MiaChat(),
            androidx.compose.runtime.rememberCoroutineScope(),
            onBack = {},
            onScreen = {},
            topic = "faturas",
        )
    }

    @Test fun bancoFaturasDark() = shot("banco-faturas-dark", night = true, scrollTo = "Cartões") {
        FaturasScreen(ScreenState(invoices.copy(current = "2026-11")), {}, {})
    }

    @Test fun bancoAjustesLight() = shot("banco-ajustes-light", night = false, scrollTo = "Bancos") {
        AjustesScreen(
            ScreenState(ajustes), SaveState.Saved, {}, {}, {}, RemindersSwitch(on = true), Fakes.devices,
            LockSwitch(on = true), Fakes.banks,
        )
    }

    /** Ajustes › Uso do Neko opened: what was used in the last 30 days, and what never was. */
    @Test fun usoAjustesDark() = shot("uso-ajustes-dark", night = true, scrollTo = "Uso do Neko", tap = "Aberto em 12 dos últimos 30 dias") {
        AjustesScreen(
            ScreenState(ajustes), SaveState.Saved, {}, {}, {}, RemindersSwitch(on = true), Fakes.devices,
            LockSwitch(on = true), usage = Fakes.usage,
        )
    }

    @Test fun loadingDark() = shot("carregando-dark", night = true) { HojeScreen(TodayState(loading = true), {}, {}) }

    @Test fun lockLight() = shot("lock-light", night = false) { LockScreen {} }

    @Test fun loginDark() = shot("login-dark", night = true) { LoginScreen {} }

    private fun shot(
        name: String,
        night: Boolean,
        scrollTo: String? = null,
        /** A text to tap before the picture, to show what it opens. */
        tap: String? = null,
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
        tap?.let { compose.onNodeWithText(it).performClick() }
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }
}
