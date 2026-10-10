package dev.johnlaff.neko.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

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
    /** Account movements the sheet does not have yet; null with no bank linked. */
    val bankMissing: List<MissingMovement>? = null,
    /** Para lançar (shared/queue.ts); null with no bank linked. */
    val queue: List<QueueItem>? = null,
    /** When the banks were last read, beside Atualizar agora. */
    val bankSyncedAt: String? = null,
    /** "Saldo bate": yesterday's Saldo against the accounts, shown when the queue is empty. */
    val saldo: SaldoView? = null,
    /** Off in Ajustes, or no writer key yet: no launch buttons. */
    val writing: Boolean = false,
    /** Cards a purchase can be launched on: their closing day is known. */
    val entryCards: List<String> = emptyList(),
    /** The Diário previsto, for its review every 3 months; null from an older Worker. */
    val previsto: PrevistoView? = null,
)

/** The Diário previsto (specs/005-lancamentos, Fase 3): on or off, its value, the bank's suggestion. */
@Serializable
data class PrevistoView(
    val on: Boolean = false,
    /** Value per day; with it off, the Diário Neko uses for the pace. */
    val value: Long = 0,
    val since: String? = null,
    /** From the bank: what a usual day costs. Null with no bank, or too little of it. */
    val suggestion: DailySuggestion? = null,
    /** Every 3 months while on: the real cost of a day since `from`, beside the value. */
    val review: PrevistoReview? = null,
    /** The last year tab: the forecast fills the days up to its December. */
    val lastYear: Int = 0,
)

@Serializable
data class DailySuggestion(
    val cards: Long,
    val pix: Long,
    val total: Long,
    val perDay: Long,
    val from: String,
    val days: Int,
)

@Serializable
data class PrevistoReview(val real: Long, val from: String)

/**
 * One cell a launch changes: "Diário de 15/10", from `before` to `after`. For the Economia tab,
 * which Neko does not read, `before` is null and `after` is the change, signed.
 */
@Serializable
data class QueueLine(
    val label: String,
    val before: Long? = null,
    val after: Long,
    val cell: QueueCell? = null,
    /** "edit", "new" (a new line) or "economia" (a signed change to the month's Economia). */
    val change: String = "edit",
    /** How much an edited line goes up or down; null for new lines and the Economia. */
    val diff: Long? = null,
)

/** The whole cell around a changed line, when it holds more than that line. */
@Serializable
data class QueueCell(val label: String, val before: Long, val after: Long)

/**
 * One way to launch an item. `draft` goes back to the Worker as is (only value, day and name may
 * change, with Ajustar); null for a question that writes nothing, answered by `answer`.
 */
@Serializable
data class QueueOption(
    val label: String,
    val draft: JsonObject? = null,
    val answer: String? = null,
    val lines: List<QueueLine> = emptyList(),
)

@Serializable
data class BankMove(val date: String, val amount: Long, val description: String)

/** What the bank showed and the sheet does not have yet (engine queue.ts). */
@Serializable
data class QueueItem(
    val key: String,
    val kind: String,
    val date: String,
    val title: String,
    val options: List<QueueOption>,
    val bank: List<BankMove> = emptyList(),
    val adjustable: Boolean = false,
    /** Why the item is there, in one plain sentence. */
    val note: String? = null,
)

/** `diff` is bank − sheet; `draft` launches it on `date`, named by the owner. */
@Serializable
data class SaldoView(
    val date: String,
    val sheet: Long,
    val bank: Long,
    val diff: Long,
    val stale: List<String> = emptyList(),
    val draft: JsonObject? = null,
)

/** What a launch or an undo did (worker/writer.ts CommitResult). */
@Serializable
data class LaunchResult(val entryId: String, val state: String, val error: String? = null)

/** A bank movement with no sheet line (engine bank.ts), and the line to paste into the note. */
@Serializable
data class MissingMovement(
    val date: String,
    val amount: Long,
    val description: String,
    val line: String,
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
    /** What the month achieved (engine recap.ts `Win`): kind "blue", "kept" or "reserve". */
    val wins: List<Win> = emptyList(),
)

@Serializable
data class Win(val kind: String, val months: Int? = null, val share: Int? = null)

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
    /** The best run before this one, the day this run passed it and the day after. */
    val record: Int? = null,
    val next: Int? = null,
    val since: String? = null,
    /** Days logged last week; null until a whole week was watched. */
    val lastWeek: Int? = null,
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
    /** "cycle": the usual card's bill. "month": with the Diário previsto on, cards and Pix against it. */
    val mode: String = "cycle",
    /** In month mode, how many days without spending bring the month back to the Diário. */
    val daysBehind: Int = 0,
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

/** GET /api/mia: whether Mia is on and how much of the month's cap is spent (specs/004-mia). */
@Serializable
data class MiaStatus(val ligada: Boolean = false, val usadoPct: Int = 0, val pausadaAte: String? = null)

/** Lançar com a Mia: the fields a sentence gave; each one only when the engine trusted it. */
@Serializable
data class MiaEntry(
    val kind: String? = null,
    val amount: Long? = null,
    val date: String? = null,
    val description: String? = null,
    val card: String? = null,
    val installments: Int? = null,
)

@Serializable
data class MiaEntryReply(val lancamento: MiaEntry? = null)

/** A value the engine handed out: money in `cents`, or a whole percent in `pct`. */
@Serializable
data class MiaValue(
    val tipo: String,
    val rotulo: String,
    val tela: String,
    val mes: String? = null,
    val cents: Long? = null,
    val pct: Int? = null,
)

/** One answer: `{{vN}}` in the text, each one's value beside it. */
@Serializable
data class MiaReply(val texto: String, val valores: Map<String, MiaValue> = emptyMap(), val modelo: String? = null)

@Serializable
data class MiaTurn(val pergunta: String, val resposta: String)

/** What Mia gets with a question: the last exchanges and the values they showed. */
@Serializable
data class MiaAsk(val pergunta: String, val historico: List<MiaTurn>, val valores: Map<String, MiaValue>)
