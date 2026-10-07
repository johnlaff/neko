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
)

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
)

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
