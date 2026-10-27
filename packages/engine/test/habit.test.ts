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

  it("forgives a missed day the next day mended", () => {
    const h = habit(days("2026-10-04", "2026-10-06", "2026-10-07"), today);
    expect(h.streak).toBe(3);
    expect(h.week[1]?.state).toBe("rest");
  });

  it("forgives every lone missed day, even twice in a week", () => {
    // Mon 5 and Wed 7 were each mended the next day: the run goes on, counting logged days.
    const h = habit(days("2026-10-04", "2026-10-06", "2026-10-08"), today);
    expect(h.streak).toBe(3);
    expect(h.week.map((w) => w.state).slice(0, 5)).toEqual([
      "edited",
      "rest",
      "edited",
      "rest",
      "edited",
    ]);
  });

  it("breaks the run on two missed days in a row", () => {
    const h = habit(
      days("2026-10-02", "2026-10-03", "2026-10-04", "2026-10-07", "2026-10-08"),
      today,
    );
    expect(h.streak).toBe(2);
    expect(h.best).toBe(3);
    expect(h.week.map((w) => w.state).slice(0, 5)).toEqual([
      "edited",
      "missed",
      "missed",
      "edited",
      "edited",
    ]);
  });

  it("keeps the run while today can still mend yesterday, and says it is at risk", () => {
    const open = habit(range("2026-10-04", "2026-10-06"), today);
    expect(open.streak).toBe(3);
    expect(open.atRisk).toBe(true);
    // Not mended yet: yesterday reads as missed until today's edit.
    expect(open.week.map((w) => w.state).slice(3, 5)).toEqual(["missed", "today"]);
    expect(open.mended).toBe(false);
    const mended = habit([...range("2026-10-04", "2026-10-06"), today], today);
    expect(mended.streak).toBe(4);
    expect(mended.atRisk).toBe(false);
    expect(mended.mended).toBe(true);
    expect(mended.week[3]?.state).toBe("rest");
    // The repair is news on its day only.
    expect(habit([...range("2026-10-04", "2026-10-06"), today], d("2026-10-09")).mended).toBe(
      false,
    );
    // Yesterday logged: today is open as any day, nothing at risk and nothing mended.
    const usual = habit(range("2026-10-04", "2026-10-07"), today);
    expect(usual.atRisk).toBe(false);
    expect(usual.mended).toBe(false);
  });

  it("mends a day across the turn of the week", () => {
    // Sat 3 and Mon 5 were each mended the next day.
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

  it("marks the day the run passes the best before it, and the day after", () => {
    // Ten days, two misses in a row (Fri 11, Sat 12) break it, then a new run from the 13th.
    const edited = [...range("2026-09-01", "2026-09-10"), ...range("2026-09-13", "2026-09-23")];
    expect(habit(edited, d("2026-09-23")).record).toBe(10);
    expect(habit(edited, d("2026-09-24")).record).toBe(10);
    expect(habit(edited, d("2026-09-25")).record).toBeNull();
    // A tie is not a record, and the first run has no best before it to pass.
    expect(habit(edited.slice(0, -1), d("2026-09-22")).record).toBeNull();
    expect(habit(range("2026-09-01", "2026-09-10"), d("2026-09-10")).record).toBeNull();
    // A short best is not worth a card: under a week, nothing to celebrate.
    const short = [...range("2026-09-01", "2026-09-04"), ...range("2026-09-13", "2026-09-17")];
    expect(habit(short, d("2026-09-17")).record).toBeNull();
  });

  it("names the next milestone", () => {
    expect(habit(range("2026-10-04", "2026-10-08"), today).next).toBe(7);
    expect(habit(range("2026-09-01", "2026-10-08"), today).next).toBe(66);
  });

  it("counts last week's logged days, once a whole week was watched", () => {
    // Last week ran Sunday 27 Sep to Saturday 3 Oct.
    const edited = days("2026-09-26", "2026-09-27", "2026-09-29", "2026-09-30", "2026-10-01");
    expect(
      habit([...edited, ...days("2026-10-02", "2026-10-03", "2026-10-05")], today).lastWeek,
    ).toBe(6);
    expect(habit(range("2026-10-01", "2026-10-08"), today).lastWeek).toBeNull();
    expect(habit([], today).lastWeek).toBeNull();
  });

  it("ignores duplicates and dates after today", () => {
    const h = habit(days("2026-10-08", "2026-10-08", "2026-10-07", "2026-10-12"), today);
    expect(h.streak).toBe(2);
  });

  it("drops the run once two days went by without an edit", () => {
    // Last edit Fri 2; Sat 3 … Wed 7 missed.
    const h = habit(range("2026-09-28", "2026-10-02"), today);
    expect(h.streak).toBe(0);
    expect(h.atRisk).toBe(false);
  });
});

describe("editDay", () => {
  it("reads an edit instant on São Paulo's calendar", () => {
    expect(editDay("2026-10-08T02:30:00.000Z")).toBe("2026-10-07");
    expect(editDay("2026-10-08T03:30:00.000Z")).toBe("2026-10-08");
  });
});
