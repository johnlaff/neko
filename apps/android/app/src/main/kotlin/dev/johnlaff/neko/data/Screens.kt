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
    val usual: UsualBill? = null,
    val history: List<BillBar> = emptyList(),
    val historyAverage: Long? = null,
    val openVsAverage: Long? = null,
    val buyToday: List<BuyGroup> = emptyList(),
    val others: List<OtherBill> = emptyList(),
    val empty: List<String> = emptyList(),
)

@Serializable
data class UsualBill(
    val card: String,
    val onSheet: Long,
    val closing: String,
    val due: String,
    val closingEstimated: Boolean = false,
    val closesInDays: Int,
)

@Serializable
data class BillBar(val due: String, val amount: Long, val open: Boolean = false)

@Serializable
data class BuyGroup(
    val cards: List<String>,
    val payInDays: Int,
    val due: String,
    val bestDate: String,
    val estimated: Boolean = false,
)

@Serializable
data class OtherBill(
    val card: String,
    val onSheet: Long,
    val due: String,
    val others: Boolean = false,
    val reimbursed: Boolean = false,
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
    /** The sheet's Economia tab, one entry per year. */
    val years: List<YearTotals> = emptyList(),
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
    /** Saída under an "Investimento:" header, and its whole-percent share of entradas. */
    val saved: Long = 0,
    val savedShare: Int? = null,
    /** Saída plus diário minus what was saved. */
    val livingCost: Long = 0,
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

/** GET /api/simulate: a purchase today on the usual card, in parcels (engine/installments.ts). */
@Serializable
data class InstallmentSimulation(
    val cycle: SimulatedCycle,
    val parcels: List<Parcel> = emptyList(),
    val lowest: MonthEnd? = null,
    val firstNegative: MonthEnd? = null,
)

@Serializable
data class SimulatedCycle(val perDay: Long, val remaining: Long, val due: String)

@Serializable
data class Parcel(val due: String, val amount: Long)

@Serializable
data class MonthEnd(val year: Int, val month: Int, val end: Long, val date: String? = null)
