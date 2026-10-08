package dev.johnlaff.neko

import dev.johnlaff.neko.data.Device
import dev.johnlaff.neko.data.HistoryPoint
import dev.johnlaff.neko.data.HistoryView
import dev.johnlaff.neko.data.InstallmentSimulation
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.data.BankAccount
import dev.johnlaff.neko.data.BankCard
import dev.johnlaff.neko.data.BankItem
import dev.johnlaff.neko.data.BanksView
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
                        BankAccount("conta", "Conta corrente", last4 = "0001", balance = 2_353_747),
                        BankAccount("cartao-azul", "Azul Platinum", card = true, last4 = "4321", balance = 1_640_00, cardNumbers = listOf("4321", "8765")),
                    ),
                ),
            ),
        ),
    )

    /** What the Worker answers for R$ 600,00 in 3x on the e2e fixture (written by screens.test.ts). */
    val simulation: InstallmentSimulation =
        json.decodeFromString(InstallmentSimulation.serializer(), File("src/test/resources/simulate.json").readText())

    val simulate: suspend (Long, Int) -> InstallmentSimulation? = { _, _ -> simulation }
}
