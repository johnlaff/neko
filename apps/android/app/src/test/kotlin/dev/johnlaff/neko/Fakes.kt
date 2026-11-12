package dev.johnlaff.neko

import dev.johnlaff.neko.data.Device
import dev.johnlaff.neko.data.HistoryPoint
import dev.johnlaff.neko.data.HistoryView
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.data.BankAccount
import dev.johnlaff.neko.data.BankCard
import dev.johnlaff.neko.data.BankItem
import dev.johnlaff.neko.data.BanksView
import dev.johnlaff.neko.data.UsageCount
import dev.johnlaff.neko.data.UsageSummary
import dev.johnlaff.neko.ui.BanksList
import dev.johnlaff.neko.ui.DevicesList
import java.io.File

/** Invented answers for the reads that only add to a screen (history, devices, simulator). */
object Fakes {
    val history = HistoryView(listOf(HistoryPoint("2026-10-01", 18_200_00), HistoryPoint("2026-10-05", 18_434_04)), 234_04)

    val devices = DevicesList(
        listOf(
            Device("a", "Android", "2026-10-05T12:00:00Z", current = true),
            Device("b", "Chrome no Windows", "2026-10-04T12:00:00Z"),
            Device("c", "Safari no iPhone", "2026-09-20T12:00:00Z"),
        ),
    )

    /** A month of use, as the same invented numbers of the site's smoke test, Simular never opened. */
    val usage = UsageSummary(
        window = 30,
        days = 12,
        android = 10,
        web = 4,
        screens = listOf(
            UsageCount("hoje", "Hoje", 31),
            UsageCount("faturas", "Faturas", 6),
            UsageCount("mes", "Mês", 3),
            UsageCount("ajustes", "Ajustes", 2),
            UsageCount("mia", "Mia", 1),
        ),
        taps = listOf(
            UsageCount("lancar", "Lançar", 9),
            UsageCount("simular", "Simular", 0),
            UsageCount("calculo", "Como calculei", 1),
            UsageCount("ler", "Ler a planilha de novo", 4),
        ),
        notices = listOf(
            UsageCount("notificacao_manha", "Contas e teto", 3),
            UsageCount("notificacao_noite", "Lançar o dia", 8),
            UsageCount("notificacao_aviso", "Avisos", 0),
        ),
    )

    /** Mia on, nothing said yet: her mark shows in the head. */
    val miaEntry = dev.johnlaff.neko.ui.MiaEntry(onOpen = { _, _ -> }, talking = { false })

    /** The same invented reply as the site's smoke test (e2e/smoke.spec.ts). */
    val miaExchange = dev.johnlaff.neko.ui.MiaExchange(
        "Quanto saiu no mês passado?",
        dev.johnlaff.neko.data.MiaReply(
            "Em setembro saíram {{v1}}, e as saídas caíram {{v2}} desde agosto.",
            mapOf(
                "v1" to dev.johnlaff.neko.data.MiaValue("total", "Saídas de 2026-09", "mes", "2026-09", cents = 512_340),
                "v2" to dev.johnlaff.neko.data.MiaValue("diferenca", "Saídas: 2026-09 menos 2026-08", "mes", cents = -20_000),
            ),
        ),
    )

    /** Mia 2 in screenshots: answers are set by hand, nothing is asked. */
    val mia2Talk = object : dev.johnlaff.neko.ui.Mia2Talk {
        override fun ask(ask: dev.johnlaff.neko.data.Mia2Ask) = kotlinx.coroutines.flow.emptyFlow<dev.johnlaff.neko.data.Mia2Line>()
        override suspend fun stop(sessao: String) = Unit
    }

    /** The same invented answers as the site's Mia 2 preview: a bar chart, then a two-line chart. */
    fun mia2Chat() = dev.johnlaff.neko.ui.Mia2Chat().apply {
        val ok = { tela: String, mes: String? -> dev.johnlaff.neko.data.Mia2Valor(true, tela, mes) }
        val months = listOf("jun", "jul", "ago", "set", "out", "nov")
        val saidas = listOf(3950.2, 4410.8, 3720.0, 4630.55, 4180.4, 2140.0)
        turns = listOf(
            dev.johnlaff.neko.ui.Mia2Turno(
                0,
                "Como foram meus últimos 6 meses?",
                listOf(
                    dev.johnlaff.neko.ui.Mia2Texto(
                        "m1",
                        "Outubro fechou em **R$ 4.180,40** de saídas, R$ 380 acima do teto de R$ 3.800.\n\n- Faturas: R$ 3.020,15\n- Pix e débito: R$ 1.160,25\n\nNovembro vai melhor: R$ 2.140 em 12 dias.",
                        mapOf(
                            "R$ 4.180,40" to ok("mes", "2026-10"),
                            "R$ 380" to ok("mes", "2026-10"),
                            "R$ 3.800" to ok("hoje", null),
                            "R$ 3.020,15" to ok("faturas", null),
                            "R$ 1.160,25" to ok("mes", "2026-10"),
                            "R$ 2.140" to dev.johnlaff.neko.data.Mia2Valor(false),
                        ),
                    ),
                    dev.johnlaff.neko.ui.Mia2Desenho(
                        "g1",
                        dev.johnlaff.neko.data.Mia2Grafico(
                            "Saídas por mês", "barras", months,
                            listOf(dev.johnlaff.neko.data.Mia2Serie("Saídas", saidas)),
                            "Novembro vai até o dia 12.",
                        ),
                    ),
                ),
            ),
            dev.johnlaff.neko.ui.Mia2Turno(
                1,
                "E o saldo, como ficou?",
                listOf(
                    dev.johnlaff.neko.ui.Mia2Desenho(
                        "g2",
                        dev.johnlaff.neko.data.Mia2Grafico(
                            "Entradas e saídas", "linha", months,
                            listOf(
                                dev.johnlaff.neko.data.Mia2Serie("Entradas", listOf(6020.0, 6020.0, 6100.0, 3918.25, 7384.07, 7384.07)),
                                dev.johnlaff.neko.data.Mia2Serie("Saídas", saidas),
                            ),
                        ),
                    ),
                    dev.johnlaff.neko.ui.Mia2Texto(
                        "m2",
                        "As entradas ficaram acima das saídas em 4 dos 6 meses. O pior foi setembro, com **R$ 712,30** a menos.",
                        mapOf("R$ 712,30" to ok("mes", "2026-09")),
                    ),
                ),
            ),
        )
    }

    /** An invented bank, the same one the site's smoke test uses (e2e/smoke.spec.ts). */
    val banks = BanksList(
        BanksView(
            configured = true,
            cards = listOf(BankCard("cartao-azul", null, "Cartão Azul")),
            items = listOf(
                BankItem(
                    "11111111-1111-4111-8111-111111111111",
                    "Banco Azul",
                    syncedAt = "2026-10-05T09:00:00.000Z",
                    accounts = listOf(
                        BankAccount("conta", "Conta corrente", last4 = "0001", balance = 2_353_747, use = "corrente"),
                        BankAccount("cartao-azul", "Azul Platinum", card = true, last4 = "4321", balance = 1_640_00, cardNumbers = listOf("4321", "8765")),
                    ),
                ),
            ),
        ),
    )

    /**
     * What the Worker answers Simular on the e2e fixture at a R$ 3.000 ceiling, with R$ 600,00 in
     * 3x and R$ 1.500 out on the 20th for two months (written by screens.test.ts).
     */
    val scenario: dev.johnlaff.neko.data.ScenarioView =
        json.decodeFromString(dev.johnlaff.neko.data.ScenarioView.serializer(), File("src/test/resources/scenario.json").readText())

    /** The lines that answer is for, as typed on the screen. */
    val scenarioRows = listOf(
        dev.johnlaff.neko.ui.SimRow(0, "compra", "600,00", 3),
        dev.johnlaff.neko.ui.SimRow(1, "saida", "1.500,00", 2, "20/10/2026"),
    )

    val askScenarios: dev.johnlaff.neko.ui.AskScenarios = { listOf(scenario) }

    /** Launches nothing: the prints only draw Para lançar and Lançar à mão. */
    val launcher = object : dev.johnlaff.neko.ui.Launcher {
        override suspend fun launch(draft: kotlinx.serialization.json.JsonObject, key: String?) = "e"
        override suspend fun undo(id: String) = true
        override suspend fun ignore(key: String) = Unit
        override suspend fun account(account: String, use: String) = Unit
        override suspend fun previsto(value: Long) = "e"
        override suspend fun keepPrevisto() = Unit
    }

    /** Same, with Mia on: Lançar à mão opens with "Numa frase". */
    val miaLauncher = object : dev.johnlaff.neko.ui.Launcher by launcher {
        override val fill: (suspend (String, List<String>) -> dev.johnlaff.neko.data.MiaEntry?) = { _, _ -> null }
    }
}
