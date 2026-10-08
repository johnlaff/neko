import { describe, expect, it } from "vitest";
import { editDay, habit, type LocalDate, localDate } from "../src/index.ts";

const d = (s: string) => localDate(s);
const days = (...xs: string[]): LocalDate[] => xs.map(d);
/** Every day from `from` to `to`, both included. */
const range = (from: string, to: string): LocalDate[] => {
  const out: LocalDate[] = [];
  for (
    let x = new Date(`${from}T00:00Z`);
    x <= new Date(`${to}T00:00Z`);
    x.setUTCDate(x.getUTCDate() + 1)
  )
    out.push(d(x.toISOString().slice(0, 10)));
  return out;
};

describe("habit", () => {
  // 2026-10-08 is a Thursday; its week runs Sunday 4 to Saturday 10.
  const today = d("2026-10-08");

  it("starts empty without any edit", () => {
    const h = habit([], today);
    expect(h.streak).toBe(0);
    expect(h.best).toBe(0);
    expect(h.editedToday).toBe(false);
    expect(h.since).toBeNull();
    expect(h.week.map((w) => w.state)).toEqual([
      "missed",
      "missed",
      "missed",
      "missed",
      "today",
      "future",
      "future",
    ]);
  });

  it("counts edited days in a row, today included", () => {
    const h = habit(range("2026-10-04", "2026-10-08"), today);
    expect(h.streak).toBe(5);
    expect(h.editedToday).toBe(true);
    expect(h.since).toBe("2026-10-04");
    expect(h.week.map((w) => w.state)).toEqual([
      "edited",
      "edited",
      "edited",
      "edited",
      "edited",
      "future",
      "future",
    ]);
  });

  it("does not break the run while today is still open", () => {
    const h = habit(range("2026-10-01", "2026-10-07"), today);
    expect(h.streak).toBe(7);
    expect(h.editedToday).toBe(false);
    expect(h.week[4]?.state).toBe("today");
  });

  it("forgives one missed day per week as a rest day", () => {
    const h = habit(days("2026-10-04", "2026-10-06", "2026-10-07"), today);
    expect(h.streak).toBe(3);
    expect(h.week[1]?.state).toBe("rest");
  });

  it("breaks the run on the second missed day of the same week", () => {
    const h = habit(days("2026-10-04", "2026-10-06", "2026-10-08"), d("2026-10-08"));
    // Mon 5 is the rest day, Wed 7 breaks the run: only today counts.
    expect(h.streak).toBe(1);
    expect(h.best).toBe(2);
    expect(h.week.map((w) => w.state).slice(0, 5)).toEqual([
      "edited",
      "rest",
      "edited",
      "missed",
      "edited",
    ]);
  });

  it("gives each week its own rest day", () => {
    // Sat 3 (week of Sep 27) and Mon 5 (week of Oct 4) are both forgiven.
    const edited = [
      ...range("2026-09-28", "2026-10-02"),
      ...days("2026-10-04"),
      ...range("2026-10-06", "2026-10-08"),
    ];
    expect(habit(edited, today).streak).toBe(9);
  });

  it("keeps the best run after a break", () => {
    const edited = [...range("2026-09-01", "2026-09-10"), ...days("2026-10-08")];
    const h = habit(edited, today);
    expect(h.streak).toBe(1);
    expect(h.best).toBe(10);
  });

  it("celebrates a milestone on the day it is reached, and the day after", () => {
    const edited = range("2026-10-02", "2026-10-08");
    expect(habit(edited, today).milestone).toBe(7);
    expect(habit(edited, d("2026-10-09")).milestone).toBe(7);
    expect(habit(edited, d("2026-10-10")).milestone).toBeNull();
    expect(habit(range("2026-10-03", "2026-10-08"), today).milestone).toBeNull();
  });

  it("names the next milestone", () => {
    expect(habit(range("2026-10-04", "2026-10-08"), today).next).toBe(7);
    expect(habit(range("2026-09-01", "2026-10-08"), today).next).toBe(66);
  });

  it("ignores duplicates and dates after today", () => {
    const h = habit(days("2026-10-08", "2026-10-08", "2026-10-07", "2026-10-12"), today);
    expect(h.streak).toBe(2);
  });

  it("drops the run once the last edit is older than the forgiven gap", () => {
    // Last edit Fri 2; Sat 3 is that week's rest; Sun 4 … Wed 7 missed.
    expect(habit(range("2026-09-28", "2026-10-02"), today).streak).toBe(0);
  });
});

describe("editDay", () => {
  it("reads an edit instant on São Paulo's calendar", () => {
    expect(editDay("2026-10-08T02:30:00.000Z")).toBe("2026-10-07");
    expect(editDay("2026-10-08T03:30:00.000Z")).toBe("2026-10-08");
  });
});
