package dev.johnlaff.neko.data

import kotlinx.serialization.Serializable

/**
 * What GET /api/today returns (apps/neko/src/shared/today.ts), already grouped and filtered.
 * Money is integer cents and dates are `yyyy-MM-dd` strings, exactly as the API sends them.
 */
@Serializable
data class TodayView(
    val today: String,
    val balanceToday: Long? = null,
    val todayLogged: Boolean = false,
    val todayUrl: String? = null,
    val canSpend: CanSpend? = null,
    val dailyForecast: Long = 0,
    val dailySource: String = "inferred",
    val upcoming: List<UpcomingDay> = emptyList(),
    val upcomingCount: Int = 0,
    val insights: List<Insight> = emptyList(),
    val saving: Saving? = null,
    val issues: List<TodayIssue> = emptyList(),
    val issuesInWindow: Int = 0,
    val readAt: String = "",
    val habit: Habit? = null,
    /** The month that just closed, in the first week of the next (engine recap.ts). */
    val recap: MonthRecap? = null,
)

@Serializable
data class MonthRecap(
    val year: Int,
    val month: Int,
    val result: Long,
    val saved: Long = 0,
    val savedShare: Int? = null,
    val livingCost: Long = 0,
    val costChange: Long? = null,
    val top: RecapTop? = null,
)

@Serializable
data class RecapTop(val label: String, val amount: Long)

/** Days the sheet changed, as a streak (engine habit.ts); one missed day a week is a rest day. */
@Serializable
data class Habit(
    val streak: Int,
    val best: Int,
    val editedToday: Boolean,
    /** Sunday to Saturday of this week. */
    val week: List<HabitDay>,
    val milestone: Int? = null,
    val next: Int? = null,
    val since: String? = null,
)

/** `state` is "edited", "rest", "missed", "today" or "future". */
@Serializable
data class HabitDay(val date: String, val state: String)

@Serializable
data class CanSpend(
    val card: String,
    val budget: Long,
    val budgetSource: String,
    val accumulated: Long,
    val daysLeft: Int,
    val perDay: Long,
    val closing: String,
    val due: String,
    val cycleDays: Int,
    val paceExpected: Long,
    val paceGap: Long,
    val overBy: Long,
    /** "over", "on-pace" or "ahead". */
    val pace: String,
)

@Serializable
data class UpcomingItem(
    val date: String,
    val description: String,
    val amount: Long,
    /** "card", "bill" or "income". */
    val kind: String,
)

@Serializable
data class UpcomingDay(val date: String, val items: List<UpcomingItem>, val net: Long)

/** One warning; which fields are set depends on `kind`, as in the engine's Insight union. */
@Serializable
data class Insight(
    val kind: String,
    val start: String? = null,
    val deepest: Long? = null,
    val deepestDate: String? = null,
    val card: String? = null,
    val over: Long? = null,
    val label: String? = null,
    val amount: Long? = null,
    val change: Long? = null,
    val closing: String? = null,
    val already: Boolean? = null,
    val until: String? = null,
    val year: Int? = null,
    val month: Int? = null,
)

@Serializable
data class Saving(
    val date: String,
    val income: Long,
    val amount: Long,
    val until: String,
    val leftAtLowest: Long,
)

@Serializable
data class CellRef(val tab: String, val a1: String)

/** A Conferência point; which fields are set depends on `kind`, as in the engine's HealthIssue. */
@Serializable
data class HealthIssue(
    val kind: String,
    val date: String,
    val ref: CellRef,
    val column: String? = null,
    val notes: Long? = null,
    val cell: Long? = null,
    val sheet: Long? = null,
    val computed: Long? = null,
    val card: String? = null,
    val lines: List<String> = emptyList(),
)

@Serializable
data class TodayIssue(val issue: HealthIssue, val url: String)

@Serializable
data class Me(val email: String? = null)

/** One reminder as GET /api/reminders sends it (worker/push.ts): `url` "/" opens the app. */
@Serializable
data class Reminder(val title: String, val body: String, val url: String, val tag: String)

@Serializable
data class RemindersView(val morning: Reminder? = null, val evening: Reminder? = null)
