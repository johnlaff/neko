import { addDays, diffDays, type LocalDate, todayIn } from "./date.ts";

/**
 * The habit the method asks for: open the sheet and log the day. A day counts when the sheet
 * changed on it. A run forgives what a habit forgives: a lone missed day is mended when the next
 * day is logged (being able to repair a streak keeps people going, Silverman and Barasch, 2023;
 * a missed day does not undo a habit, Lally et al., 2010). Only two days in a row without a
 * change break it, and today never does while it is still open.
 */

/** 66 days is the median time for a habit to settle (Lally et al., 2010). */
export const HABIT_MILESTONES = [7, 21, 66, 100, 200, 365] as const;
/** The shortest earlier best worth celebrating when a new run passes it. */
export const RECORD_MIN = 7;

/** `rest`: a lone missed day the next day mended (the name predates the rule, apps read it). */
export type HabitDayState = "edited" | "rest" | "missed" | "today" | "future";

export interface HabitDay {
  readonly date: LocalDate;
  readonly state: HabitDayState;
}

export interface Habit {
  /** Days the sheet changed in the current run; mended days keep it but do not add to it. */
  readonly streak: number;
  /** Longest run so far. */
  readonly best: number;
  readonly editedToday: boolean;
  /** Yesterday went without a change: only an edit today keeps the run. */
  readonly atRisk: boolean;
  /** Today's edit mended yesterday: the day the repair is worth saying. */
  readonly mended: boolean;
  /** This week, Sunday to Saturday. */
  readonly week: readonly HabitDay[];
  /** The milestone the run reached on its last edit, while that edit is today or yesterday. */
  readonly milestone: number | null;
  /**
   * The best run before this one, on the day this run passed it and the day after (a personal
   * record, Strava-style); null otherwise or when that best was under a week.
   */
  readonly record: number | null;
  /** Next milestone above the current run; null past the last one. */
  readonly next: number | null;
  /** First day an edit was seen; null with none. */
  readonly since: LocalDate | null;
  /** Days logged last week (Sunday to Saturday); null until a whole week was watched. */
  readonly lastWeek: number | null;
}

/** Day of the week, 0 = Sunday. */
const weekday = (d: LocalDate): number => new Date(`${d}T00:00:00Z`).getUTCDay();

const weekStart = (d: LocalDate): LocalDate => addDays(d, -weekday(d));

/** The civil day in São Paulo on which the sheet was edited, from Drive's `modifiedTime`. */
export const editDay = (modifiedTime: string): LocalDate => todayIn(new Date(modifiedTime));

export const habit = (edits: readonly LocalDate[], today: LocalDate): Habit => {
  const edited = new Set(edits.filter((e) => e <= today));
  const sorted = [...edited].sort();
  const since = sorted[0] ?? null;
  const state = new Map<LocalDate, HabitDayState>();
  let run = 0;
  let best = 0;
  let runAtLastEdit = 0;
  let lastEdit: LocalDate | null = null;
  let bestBefore = 0;
  if (since !== null) {
    for (let d = since; d <= today; d = addDays(d, 1)) {
      if (edited.has(d)) {
        run++;
        best = Math.max(best, run);
        runAtLastEdit = run;
        lastEdit = d;
        state.set(d, "edited");
      } else if (d === today) {
        state.set(d, "today");
      } else {
        const next = addDays(d, 1);
        const lone = edited.has(addDays(d, -1));
        if (lone && edited.has(next)) state.set(d, "rest");
        else {
          state.set(d, "missed");
          // Yesterday alone can still be mended today: the run waits for today to end.
          if (!(lone && next === today)) {
            run = 0;
            bestBefore = best;
          }
        }
      }
    }
  }
  const start = weekStart(today);
  const week = Array.from({ length: 7 }, (_, i): HabitDay => {
    const date = addDays(start, i);
    const s = date > today ? "future" : (state.get(date) ?? (date === today ? "today" : "missed"));
    return { date, state: s };
  });
  const lastStart = addDays(start, -7);
  const lastWeek =
    since !== null && since <= lastStart
      ? Array.from({ length: 7 }, (_, i) => addDays(lastStart, i)).filter((x) => edited.has(x))
          .length
      : null;
  const recent = lastEdit !== null && diffDays(lastEdit, today) <= 1 && run === runAtLastEdit;
  return {
    streak: run,
    best,
    editedToday: edited.has(today),
    atRisk: run > 0 && !edited.has(today) && !edited.has(addDays(today, -1)),
    mended: state.get(addDays(today, -1)) === "rest",
    week,
    milestone:
      recent && (HABIT_MILESTONES as readonly number[]).includes(runAtLastEdit)
        ? runAtLastEdit
        : null,
    record:
      recent && bestBefore >= RECORD_MIN && runAtLastEdit === bestBefore + 1 ? bestBefore : null,
    next: HABIT_MILESTONES.find((m) => m > run) ?? null,
    since,
    lastWeek,
  };
};
