import { addDays, diffDays, type LocalDate, todayIn } from "./date.ts";

/**
 * The habit the method asks for: open the sheet and log the day. A day counts when the sheet
 * changed on it. Streaks follow the forgiving pattern that keeps a habit without punishing it:
 * one missed day per week (Sunday to Saturday) is a rest day and keeps the run going, and today
 * never breaks it while it is still open.
 */

/** 66 days is the median time for a habit to settle (Lally et al., 2010). */
export const HABIT_MILESTONES = [7, 21, 66, 100, 200, 365] as const;

export type HabitDayState = "edited" | "rest" | "missed" | "today" | "future";

export interface HabitDay {
  readonly date: LocalDate;
  readonly state: HabitDayState;
}

export interface Habit {
  /** Days the sheet changed in the current run; rest days keep it but do not add to it. */
  readonly streak: number;
  /** Longest run so far. */
  readonly best: number;
  readonly editedToday: boolean;
  /** This week, Sunday to Saturday. */
  readonly week: readonly HabitDay[];
  /** The milestone the run reached on its last edit, while that edit is today or yesterday. */
  readonly milestone: number | null;
  /** Next milestone above the current run; null past the last one. */
  readonly next: number | null;
  /** First day an edit was seen; null with none. */
  readonly since: LocalDate | null;
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
  if (since !== null) {
    const misses = new Map<LocalDate, number>();
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
        const week = weekStart(d);
        const n = (misses.get(week) ?? 0) + 1;
        misses.set(week, n);
        if (n === 1) state.set(d, "rest");
        else {
          run = 0;
          state.set(d, "missed");
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
  const recent = lastEdit !== null && diffDays(lastEdit, today) <= 1 && run === runAtLastEdit;
  return {
    streak: run,
    best,
    editedToday: edited.has(today),
    week,
    milestone:
      recent && (HABIT_MILESTONES as readonly number[]).includes(runAtLastEdit)
        ? runAtLastEdit
        : null,
    next: HABIT_MILESTONES.find((m) => m > run) ?? null,
    since,
  };
};
