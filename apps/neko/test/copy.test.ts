import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HealthIssue, Insight, Win } from "@neko/engine";
import { describe, expect, it } from "vitest";
import { winShareText, winText } from "../src/shared/wins.ts";
import { insightView, issueText } from "../src/web/Alerts.tsx";
import {
  bankText,
  closesIn,
  days,
  merchantName,
  money,
  relativeDay,
  shortDate,
  signed,
} from "../src/web/format.ts";
import {
  CARDS_COME_FROM,
  costLabel,
  coveredLabel,
  dailySourceText,
  HABIT,
  HINTS,
  IDEAS,
  LEARN_INTRO,
  RESERVE,
  resultNote,
  streakLabel,
  TOTALS,
} from "../src/web/learn.ts";
import { milestoneText } from "../src/web/Streak.tsx";

const ref = { tab: "2026", a1: "BB15" };

/** One of each warning, Conferência point and win, with the variations their words have. */
const INSIGHTS = [
  {
    kind: "goes-negative",
    already: false,
    start: "2026-11-12",
    deepest: -1234_56,
    deepestDate: "2026-11-20",
  },
  {
    kind: "goes-negative",
    already: true,
    start: "2026-10-04",
    until: "2026-10-30",
    deepest: -50_00,
    deepestDate: "2026-10-10",
  },
  { kind: "month-negative", year: 2026, month: 11, amount: 820_00 },
  { kind: "income-committed", year: 2026, month: 12, share: 92, amount: 400_00 },
  { kind: "income-committed", year: 2026, month: 12, share: 104, amount: -310_00 },
  { kind: "no-spending-ahead", year: 2027, month: 1 },
  { kind: "bill-above-average", card: "Cartão Azul", over: 310_40 },
  { kind: "fixed-up", label: "luz", amount: 230_00, change: 41_10 },
  { kind: "closing-estimated", card: "Cartão Verde", closing: "2026-11-03" },
] as unknown as Insight[];

const ISSUES = [
  { kind: "missing-date", date: "2026-10-02", ref },
  { kind: "note-mismatch", date: "2026-10-03", ref, column: "saida", notes: 120_00, cell: 125_00 },
  { kind: "balance-mismatch", date: "2026-10-04", ref, sheet: 900_00, computed: 905_50 },
  { kind: "missing-bill", date: "2026-10-05", ref, card: "Cartão Azul" },
  { kind: "unparsed-note", date: "2026-10-06", ref, column: "diario", lines: ["padaria 12"] },
] as unknown as HealthIssue[];

const WINS: Win[] = [
  { kind: "blue", months: 1 },
  { kind: "blue", months: 3 },
  { kind: "kept", share: 25 },
  { kind: "cards-down" },
  { kind: "record", share: 32 },
  { kind: "reserve", months: 1 },
  { kind: "reserve", months: 4 },
] as Win[];

/**
 * Every sentence and label the site and the Android app both show, as the site says it: the
 * app's unit tests (CopyContractTest.kt) read this file and fail when a word differs, the same
 * way the category icons are kept equal. UPDATE_CONTRACT=1 rewrites it after a copy change.
 */
const contract = () => ({
  learn: {
    hints: HINTS,
    intro: LEARN_INTRO,
    cardsComeFrom: CARDS_COME_FROM,
    ideas: IDEAS,
    habit: HABIT,
    reserve: RESERVE,
    totals: TOTALS,
  },
  format: {
    money: [0, 1_234_56, 1_000_000_05, -7_50].map((c) => [c, money(c)]),
    signed: [
      [10_00, "+"],
      [-10_00, "−"],
      [0, "+"],
    ].map(([c, s]) => [c, s, signed(c as number, s as "+" | "−")]),
    shortDate: ["2026-10-13", "2027-01-01"].map((d) => [d, shortDate(d)]),
    relativeDay: [
      ["2026-10-05", "2026-10-05"],
      ["2026-10-06", "2026-10-05"],
      ["2026-10-09", "2026-10-05"],
      ["2026-10-11", "2026-10-05"],
    ].map(([d, t]) => [d, t, relativeDay(d as string, t as string)]),
    days: [1, 3].map((n) => [n, days(n)]),
    closesIn: [1, 2, 4].map((n) => [n, closesIn(n)]),
    bankText: [
      "PIX FEIRA DO BAIRRO",
      "PIX RECEBIDO ANA",
      "PAG*LOJA 123 SÃO PAULO",
      "Uber *Trip",
    ].map((t) => [t, bankText(t)]),
    merchantName: [
      "DL      *UberRides",
      "MP*MERCADOLIVRE",
      "PAYPAL *NETFLIX",
      "UBER  *TRIP",
      "DL *",
    ].map((t) => [t, merchantName(t)]),
  },
  labels: {
    streak: [0, 1, 12].map((n) => [n, streakLabel(n)]),
    milestone: [7, 66, 500].map((m) => [m, milestoneText(m)]),
    covered: [6, 10, 16, 20].map((t) => [t, coveredLabel(t)]),
    cost: [1, 3].map((m) => [m, costLabel(m)]),
    result: [true, false].map((down) => [down, resultNote(down)]),
    dailySource: (["settings", "sheet-note", "inferred"] as const).map((s) => [
      s,
      dailySourceText(s),
    ]),
  },
  insights: INSIGHTS.map((insight) => {
    const v = insightView(insight);
    return { insight, title: v?.title, detail: v?.detail };
  }),
  issues: ISSUES.map((issue) => ({ issue, ...issueText(issue) })),
  wins: WINS.map((win) => ({ win, text: winText(win), share: winShareText(win) })),
});

describe("copy contract", () => {
  it("starts every label and line with a capital letter", () => {
    const c = contract();
    const lines = [
      ...Object.values(c.learn.hints),
      c.learn.intro,
      c.learn.habit.rule,
      c.learn.habit.atRisk,
      ...Object.values(c.learn.totals),
      ...c.insights.flatMap((i) => [i.title ?? "", i.detail ?? ""]),
      ...c.issues.flatMap((i) => [i.title, i.detail]),
      ...c.wins.map((w) => w.text),
    ];
    for (const l of lines) expect(l, l).toMatch(/^[A-ZÀ-Ý0-9"]/);
  });

  it("matches the file the Android app checks its words against", () => {
    const path = join(import.meta.dirname, "../../android/app/src/test/resources/copy.json");
    const c = contract();
    if (process.env.UPDATE_CONTRACT) writeFileSync(path, `${JSON.stringify(c, null, 2)}\n`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(JSON.parse(JSON.stringify(c)));
  });
});
