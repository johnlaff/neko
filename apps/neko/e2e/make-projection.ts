/**
 * Writes e2e/projection.json from an invented ledger, so the smoke test runs on realistic shapes
 * without anyone's real finances. Run: node --experimental-strip-types e2e/make-projection.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addDays,
  billChecks,
  buildQueue,
  type CellValue,
  cents,
  type DayRow,
  habit,
  inferCards,
  type LocalDate,
  localDate,
  mergeCards,
  type NoteItem,
  parts,
  project,
  saldoCheck,
  unmatchedMovements,
} from "../../../packages/engine/src/index.ts";
import { queueView } from "../src/shared/queue.ts";
import type { ProjectionResponse } from "../src/shared/types.ts";

/** Seeded, so the fixture only changes when this file does. */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = mulberry32(2026);
const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));

const TODAY = localDate("2026-10-05");
const START = localDate("2025-01-01");
const DAYS = 730;
const TAB = (d: LocalDate) => String(parts(d).year);

const item = (amount: number, description: string, section: string | null): NoteItem => ({
  amount: cents(amount),
  description,
  section,
});
const cellOf = (items: NoteItem[], ref: string, d: LocalDate): CellValue => ({
  amount: cents(items.reduce((s, i) => s + i.amount, 0)),
  items,
  unparsed: [],
  ref: { tab: TAB(d), a1: ref },
});

/** Monthly card bills, in cents: the usual card grows a little toward the end of the year. */
const azul = (month: number) => between(2_400_00, 3_600_00) + month * 20_00;

const rows: DayRow[] = [];
let saldo = 8_500_00;
for (let i = 0, d = START; i < DAYS; i++, d = addDays(d, 1)) {
  const { day, month } = parts(d);
  const entrada: NoteItem[] = [];
  const saida: NoteItem[] = [];
  if (day === 5) entrada.push(item(5_600_00, "Salário", null));
  if (day === 20) entrada.push(item(1_900_00, "Adiantamento", null));
  if (day === 10) {
    saida.push(item(1_900_00, "Aluguel", "contas"));
    saida.push(item(between(180_00, 260_00), "Luz", "contas"));
    saida.push(item(120_00, "Internet", "contas"));
  }
  if (day === 15) saida.push(item(320_00, "Academia e curso", "contas"));
  if (day === 12) {
    saida.push(item(azul(month), "Cartão Azul", "cartoes"));
    saida.push(item(between(300_00, 700_00), "Cartão Verde", "cartoes"));
  }
  if (day === 20) saida.push(item(800_00, "Poupança", "reserva"));
  if (day === 12) entrada.push(item(between(300_00, 700_00), "Reembolso Cartão Verde", null));
  // Months after today only hold what is already known: bills and fixed costs, no diário.
  const past = d <= TODAY;
  const diario: NoteItem[] =
    past && day % 3 === 0 ? [item(between(15_00, 90_00), "Padaria e mercado", null)] : [];
  const col = (n: number) => `${String.fromCharCode(65 + (month - 1) * 4 + n)}${day + 4}`;
  const e = cellOf(entrada, col(0), d);
  const s = cellOf(saida, col(1), d);
  const di = cellOf(diario, col(2), d);
  saldo += e.amount - s.amount - di.amount;
  rows.push({
    date: d,
    entrada: e,
    saida: s,
    diario: di,
    saldo: cents(saldo),
    saldoRef: { tab: TAB(d), a1: col(3) },
    dateCellOk: true,
    dateRef: { tab: TAB(d), a1: `A${day + 4}` },
  });
}

const cards = mergeCards(inferCards(rows), []);
const dailyForecast = cents(95_00);
const projection = project(rows, TODAY, {
  dailyForecast,
  usualCard: null,
  cycleBudget: null,
  cards,
  othersCards: ["Cartão Verde"],
});

/** An invented bank: the usual card's next bills and a few account movements, two of them new. */
const bankLine = (
  amount: number,
  billMonth: string,
  description: string,
  n?: number,
  of?: number,
) => ({
  card: "Cartão Azul",
  amount: cents(amount),
  billMonth,
  description,
  installment: n ?? null,
  installments: of ?? null,
});
const movements = [
  { id: "m1", date: localDate("2026-10-05"), amount: cents(5_600_00), description: "SALARIO" },
  {
    id: "m2",
    date: localDate("2026-10-03"),
    amount: cents(-42_50),
    description: "PIX FEIRA DO BAIRRO",
  },
  {
    id: "m3",
    date: localDate("2026-10-04"),
    amount: cents(150_00),
    description: "PIX RECEBIDO ANA",
  },
];
const queue = buildQueue({
  ledger: rows,
  cards,
  today: TODAY,
  since: addDays(TODAY, -10),
  movements,
  lines: [],
  closed: [],
  othersCards: ["Cartão Verde"],
  accounts: [{ id: "conta", label: "Banco Azul", use: "corrente" }],
  savedOrigins: new Set(),
  decided: new Set(),
});
const bank = {
  syncedAt: "2026-10-05T09:00:00.000Z",
  queue: queueView(queue, rows, cards),
  saldo: saldoCheck(rows, TODAY, [
    { label: "Banco Azul", balance: cents(2_353_747), readOn: TODAY },
  ]),
  checks: billChecks(
    rows,
    cards,
    [
      bankLine(1_640_00, "2026-11", "Compras do ciclo"),
      bankLine(450_00, "2026-11", "LOJA DE MÓVEIS PARC 03/06", 3, 6),
      bankLine(129_90, "2026-11", "FONE PARC 01/03", 1, 3),
    ],
    TODAY,
  ),
  missing: unmatchedMovements(rows, movements, TODAY),
};

const response: ProjectionResponse = {
  projection,
  daily: { value: dailyForecast, source: "inferred", sheetNote: null, inferred: dailyForecast },
  cardsKnown: cards,
  sheet: {
    id: "planilha-de-exemplo",
    version: "1",
    modifiedTime: "2026-10-05T11:00:00.000Z",
    readAt: "2026-10-05T11:00:00.000Z",
    tabs: { "2025": 1, "2026": 2 },
  },
  // Twelve days in a row, with one rest day: today is still open.
  habit: habit(
    Array.from({ length: 13 }, (_, i) => addDays(TODAY, i - 13)).filter((d) => d !== "2026-09-30"),
    TODAY,
  ),
  writing: true,
  bank,
};

writeFileSync(
  join(import.meta.dirname, "projection.json"),
  `${JSON.stringify(response, null, 2)}\n`,
);
