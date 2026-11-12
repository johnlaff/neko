package dev.johnlaff.neko.data

import kotlinx.serialization.Serializable

/**
 * What GET /api/invoices, /api/months and /api/ajustes return (apps/neko/src/shared/screens.ts),
 * already filtered, grouped and sorted. Money is integer cents, dates `yyyy-MM-dd`.
 */
@Serializable
data class InvoicesView(
    val today: String,
    val readAt: String = "",
    val hasCards: Boolean = false,
    /** Oldest first, each with the cards due in it. */
    val months: List<InvoiceMonth> = emptyList(),
    /** The month to open on: the next bill still to pay. */
    val current: String? = null,
    /** Mean of the non-empty months before today's: the chart's dashed line. */
    val average: Long? = null,
    val buyToday: List<BuyGroup> = emptyList(),
    /** Last bank read; null with no bank linked. */
    val bank: BankRead? = null,
    /** Monthly charges found on the bank, with the marks to cancel; null with none. */
    val subscriptions: Subscriptions? = null,
    /** Names already used for someone else's purchases, most recent first, to pick again. */
    val people: List<String> = emptyList(),
)

@Serializable
data class BankRead(val syncedAt: String? = null)

/** Charges of the same value back each month on the owner's cards (shared/types.ts SubscriptionsView). */
@Serializable
data class Subscriptions(
    val items: List<Subscription> = emptyList(),
    val total: Long = 0,
    val toCancel: Long = 0,
)

@Serializable
data class Subscription(
    val key: String,
    val description: String,
    val card: String,
    val amount: Long,
    val last: String,
    val charges: Int,
    val twin: Boolean = false,
    val cancel: Boolean = false,
)

/** Every card due in one month (shared/screens.ts InvoiceMonthView). */
@Serializable
data class InvoiceMonth(
    val key: String,
    val total: Long,
    val past: Boolean = false,
    val future: Boolean = false,
    val cards: List<InvoiceRow> = emptyList(),
    /** The month against the bank; null when the bank has none of its bills. */
    val bank: MonthBank? = null,
    /** Purchases on the month's bills marked as someone else's: what each will pay back. */
    val owed: List<Owed> = emptyList(),
)

/** One person's purchases on a month's bills (engine `Owed`); `later` is their parcels still to come. */
@Serializable
data class Owed(
    val person: String,
    val total: Long,
    val later: Long = 0,
    val lines: Int = 0,
    /** Biggest first, each with the bill it is on. */
    val items: List<OwedItem> = emptyList(),
)

/** One of someone else's purchases: its card, the due day of its bill, the parcels still to come. */
@Serializable
data class OwedItem(
    val card: String,
    val description: String,
    val amount: Long,
    val date: String? = null,
    val installment: Int? = null,
    val installments: Int? = null,
    val later: Long = 0,
    val due: String? = null,
    /** Its mark, to change whose it is from here. */
    val key: String = "",
)

@Serializable
data class MonthBank(val disagree: Int = 0, val parcels: Long = 0, val fresh: Long = 0)

/** One card's bill in a month: the sheet's amount, where it stands, what the bank has on it. */
@Serializable
data class InvoiceRow(
    val card: String,
    val due: String,
    val closing: String,
    val amount: Long,
    /** "due", "closed", "open" or "future". */
    val state: String,
    val closesInDays: Int = 0,
    val closingEstimated: Boolean = false,
    val others: Boolean = false,
    val reimbursed: Boolean = false,
    val bank: RowBank? = null,
    val limit: CardLimit? = null,
    val history: List<MonthAmount> = emptyList(),
)

@Serializable
data class RowBank(
    val amount: Long,
    val parcels: Long = 0,
    val gap: Long = 0,
    val closed: Boolean = false,
    val disagrees: Boolean = false,
    val onlyParcels: Boolean = false,
    val lines: List<BankLine> = emptyList(),
)

@Serializable
data class BankLine(
    val description: String,
    val amount: Long,
    val date: String? = null,
    val installment: Int? = null,
    val installments: Int? = null,
    /** What a mark of someone else's holds on to; null for a refund or an old line. */
    val key: String? = null,
    /** Whose it is, when marked as someone else's; null for yours. */
    val person: String? = null,
    /** Only on the bank's bill PDF: Open Finance left it out (or put it on another bill). */
    val fromStatement: Boolean = false,
)

@Serializable
data class CardLimit(val limit: Long, val available: Long)

@Serializable
data class MonthAmount(val month: String, val amount: Long)

/** GET /api/banks (shared/types.ts BanksResponse): Ajustes › Bancos. */
@Serializable
data class BanksView(
    val configured: Boolean = false,
    val cards: List<BankCard> = emptyList(),
    val items: List<BankItem> = emptyList(),
)

@Serializable
data class BankCard(val accountId: String, val cardNumber: String?, val card: String)

@Serializable
data class BankItem(
    val itemId: String,
    val label: String,
    val syncedAt: String? = null,
    val error: String? = null,
    val accounts: List<BankAccount> = emptyList(),
)

@Serializable
data class BankAccount(
    val id: String,
    val name: String,
    val card: Boolean = false,
    val last4: String? = null,
    val balance: Long = 0,
    val cardNumbers: List<String> = emptyList(),
    /** For an account (not a card): "guardado" or "corrente", as the owner said; null unanswered. */
    val use: String? = null,
)

@Serializable
data class BankLink(val itemId: String, val label: String)

@Serializable
data class BuyGroup(
    val cards: List<String>,
    val payInDays: Int,
    val due: String,
    val bestDate: String,
    val estimated: Boolean = false,
)

@Serializable
data class MonthsView(
    val today: String,
    val readAt: String = "",
    val current: String? = null,
    val months: List<MonthItem> = emptyList(),
    /** Next payday's saving: the termômetro marks its day in that month. */
    val saving: Saving? = null,
    /** The emergency reserve; null before a month closed. */
    val reserve: Reserve? = null,
    /** The reserve in steps, up to the method's 6 and 12 months; null without a reserve. */
    val steps: ReserveSteps? = null,
    /** The sheet's Economia tab, one entry per year. */
    val years: List<YearTotals> = emptyList(),
    /** Warnings that live here, not on Hoje: all on today's month, each also on its own. */
    val warnings: List<Insight> = emptyList(),
)

/** The method's emergency reserve: cost of living times 6 to 12 months, against what was kept. */
@Serializable
data class Reserve(
    val cost: Long,
    val costMonths: Int,
    val min: Long,
    val max: Long,
    val kept: Long,
    val coveredTenths: Int,
)

/** A step on the way to the reserve: `months` is null for the first one, a plain amount. */
@Serializable
data class ReserveStep(val amount: Long, val months: Int? = null)

/** The steps (engine reserve.ts): how many are kept, the next one and what it still needs. */
@Serializable
data class ReserveSteps(
    val steps: List<ReserveStep>,
    val reached: Int,
    val next: ReserveStep? = null,
    val missing: Long,
)

/** What the payday saving does to the steps: the step reached, or the next one and what it needs. */
@Serializable
data class SavingStep(val step: ReserveStep, val index: Int, val missing: Long)

@Serializable
data class YearTotals(val year: Int, val entrada: Long, val saved: Long, val savedShare: Int? = null)

@Serializable
data class MonthItem(
    val key: String,
    val year: Int,
    val month: Int,
    val past: Boolean = false,
    val future: Boolean = false,
    val startBalance: Long = 0,
    val entrada: Long = 0,
    val saida: Long = 0,
    val diario: Long = 0,
    val endSheet: Long = 0,
    val result: Long? = null,
    val outflows: List<Outflow> = emptyList(),
    val fixed: List<Fixed> = emptyList(),
    val fixedTotal: Long = 0,
    /** The termômetro: each day's balance and band, with what moved it. */
    val days: List<ThermoDay> = emptyList(),
    /** Saída under a "Reserva:" header, and its whole-percent share of entradas. */
    val saved: Long = 0,
    val savedShare: Int? = null,
    /** The part of `saved` dated up to today: less than it while Reserva lines are still ahead. */
    val savedToDate: Long = 0,
    /** Saída plus diário minus what was saved. */
    val livingCost: Long = 0,
    /** The diário médio real: what a day cost, card bills included; null on a month ahead. */
    val dailyAverage: Long? = null,
    /** What a closed month achieved, as its recap showed it; empty for the others. */
    val wins: List<Win> = emptyList(),
)

@Serializable
data class Outflow(
    val label: String,
    val amount: Long,
    val count: Int = 1,
    /** "card" or "bill". */
    val kind: String = "bill",
    val change: Long? = null,
    val others: Boolean = false,
    /** The last months of this destination, oldest first, opened by a tap on its line. */
    val trend: List<TrendPoint> = emptyList(),
    /** Its bill that comes back every month or its installment; null for the others. */
    val fixed: Fixed? = null,
)

@Serializable
data class TrendPoint(val year: Int, val month: Int, val amount: Long)

@Serializable
data class Fixed(val label: String, val amount: Long, val installment: Installment? = null)

@Serializable
data class Installment(val paid: Int, val total: Int, val ends: YearMonth, val left: Long)

@Serializable
data class YearMonth(val year: Int, val month: Int)

@Serializable
data class AjustesView(
    val settings: UserSettings,
    val cards: List<CardConfig> = emptyList(),
    val dailyAuto: Long = 0,
    /** The Diário previsto; null from a Worker that predates it. */
    val previsto: PrevistoView? = null,
    /** Avisos de compra: how each bank app's reads fared against the bank. */
    val phone: List<PhoneTrust> = emptyList(),
)

/** One bank app's reads against the bank (engine phone.ts PhoneTrust). */
@Serializable
data class PhoneTrust(
    val bank: String,
    /** Reads the bank already judged: it brought them, or never did. */
    val judged: Int = 0,
    /** Of those, the ones the bank brought: same card, same amount. */
    val matched: Int = 0,
    /** The ceiling counts this bank app's reads (released by hand on the Worker). */
    val trusted: Boolean = false,
)

/** The Worker's UserSettings (apps/neko/src/shared/types.ts), sent back whole on PUT. */
@Serializable
data class UserSettings(
    val dailyForecast: Long? = null,
    val usualCard: String? = null,
    val cycleBudget: Long? = null,
    val cards: List<CardDays> = emptyList(),
    val othersCards: List<String> = emptyList(),
    val reviewed: List<String> = emptyList(),
    /** Lançar pelo Neko; left out (null), the Worker keeps it as it is. */
    val writing: Boolean? = null,
)

@Serializable
data class CardDays(val name: String, val closingDay: Int, val dueDay: Int)

@Serializable
data class CardConfig(
    val name: String,
    val dueDay: Int,
    val closingDay: Int,
    val closingEstimated: Boolean = false,
)

/** One day of the termômetro; `band` is "negative", "attention", "healthy" or "surplus". */
@Serializable
data class ThermoDay(
    val day: Int,
    val balance: Long,
    val band: String,
    /** After today: a forecast, not what happened. */
    val future: Boolean = false,
    val moves: List<DayMove> = emptyList(),
)

/** What moved a day's balance; `kind` is "income", "bill", "card" or "diario". */
@Serializable
data class DayMove(val kind: String, val description: String = "", val amount: Long)

/** GET /api/history: this month's end as read along the month; `delta` is how much it moved. */
@Serializable
data class HistoryView(val points: List<HistoryPoint> = emptyList(), val delta: Long? = null)

@Serializable
data class HistoryPoint(val today: String, val monthEndProjected: Long)

/** One signed-in device, as GET /api/sessions lists them (the current one first). */
@Serializable
data class Device(
    val id: String,
    val device: String,
    val lastSeenAt: String = "",
    val current: Boolean = false,
)

/**
 * GET /api/usage: how often each screen and tap was used in the last [window] days, counted on
 * Neko's own server. Only counts: nothing of what the screens showed.
 */
@Serializable
data class UsageSummary(
    val window: Int,
    /** Days with any use, on either app. */
    val days: Int,
    val android: Int,
    val web: Int,
    /** Every screen, then every button, then every kind of notification, the ones never used with zero. */
    val screens: List<UsageCount>,
    val taps: List<UsageCount>,
    /** Taps on each kind of notification; absent from a Worker that predates them. */
    val notices: List<UsageCount> = emptyList(),
)

@Serializable
data class UsageCount(val event: String, val label: String, val count: Int)

/** GET /api/simulate: a purchase today on the usual card, in parcels (engine/installments.ts). */
@Serializable
data class InstallmentSimulation(
    val cycle: SimulatedCycle,
    val parcels: List<Parcel> = emptyList(),
    val lowest: MonthEnd? = null,
    val firstNegative: MonthEnd? = null,
)

@Serializable
data class SimulatedCycle(val remaining: Long, val due: String)

@Serializable
data class Parcel(val due: String, val amount: Long)

@Serializable
data class MonthEnd(val year: Int, val month: Int, val end: Long, val date: String? = null)

/**
 * POST /api/scenario: Simular (shared/screens.ts scenarioView). The sheet's balances under a pace
 * for the day to day and a few what-ifs; nothing is saved, and every answer is asked again.
 */
@Serializable
data class ScenarioView(
    /** "planilha", "teto" or "media": the one this answer used. */
    val pace: String,
    /** What each month ahead spends in the scenario; null for the sheet as it is. */
    val monthly: Long? = null,
    val days: List<ScenarioDay> = emptyList(),
    val months: List<ScenarioMonth> = emptyList(),
    val lowest: ScenarioPoint? = null,
    val firstNegative: ScenarioPoint? = null,
    val saving: Saving? = null,
    /** "Ainda cabem" once the purchases' first parcels are on it; null without a purchase. */
    val cycle: SimulatedCycle? = null,
    /**
     * The months from next on (`YYYY-MM`) whose own bills already take the whole pace: there the
     * answer counts nothing else spent, a premise said out loud.
     */
    val full: List<String> = emptyList(),
    /** What the changes take from (negative) or add to the lowest balance and the end; null without changes. */
    val effect: ScenarioEffect? = null,
    /** Each change on its own, in the order asked, without the refused ones. */
    val effects: List<ScenarioChangeEffect> = emptyList(),
    val today: String,
    /** When the sheet was read: the answer is only as fresh as that. */
    val readAt: String = "",
    /** The sheet's last day: nothing past it to simulate on. */
    val end: String,
    /** The usual card a purchase goes on, and the bill its first parcel lands on. */
    val card: String? = null,
    val due: String? = null,
    /** The paces this sheet and Ajustes allow, in order. */
    val paces: List<String> = listOf("planilha"),
    /** What the ceiling and the last months' average spend a month; null without one. */
    val spends: ScenarioSpends = ScenarioSpends(),
    /** The first day the pace counts (next month's first); null for the sheet as it is. */
    val paceFrom: String? = null,
    /** The changes the engine refused, by their place in the ask; the answer leaves them out. */
    val refused: List<Int> = emptyList(),
    val canSpend: ScenarioCanSpend? = null,
)

@Serializable
data class ScenarioEffect(val lowest: Long, val end: Long)

/** One change on its own: its effect, the parcels the pace holds, and the dates the sheet reaches. */
@Serializable
data class ScenarioChangeEffect(
    val lowest: Long,
    val end: Long,
    val inPace: ScenarioHeld? = null,
    val counted: Int = 0,
    val of: Int = 0,
)

/** A purchase's parcels inside the pace: they move no balance and leave less of each month. */
@Serializable
data class ScenarioHeld(val count: Int, val amount: Long, val perMonth: Long, val until: String)

@Serializable
data class ScenarioSpends(val teto: Long? = null, val media: Long? = null)

@Serializable
data class ScenarioDay(val date: String, val sheet: Long, val sim: Long)

@Serializable
data class ScenarioMonth(val year: Int, val month: Int, val endSheet: Long, val endSim: Long)

@Serializable
data class ScenarioPoint(val date: String, val balance: Long)

/** Hoje's "Ainda cabem" as a purchase's own figure reads it. */
@Serializable
data class ScenarioCanSpend(val mode: String, val left: Long, val overBy: Long, val due: String = "")

/** What Simular asks: a pace (null for the default) and the what-ifs typed so far. */
@Serializable
data class ScenarioBody(val pace: String? = null, val changes: List<ScenarioChange> = emptyList())

/** A purchase (`count` parcels) or money in or out (`date`, repeated `months` months). */
@Serializable
data class ScenarioChange(
    val kind: String,
    val amount: Long,
    val count: Int? = null,
    val date: String? = null,
    val months: Int? = null,
)
