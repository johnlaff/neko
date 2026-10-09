import {
  type BankCardLine,
  type BankMovement,
  billChecks,
  type ClosedBill,
  matchMovements,
  type SheetLine,
} from "./bank.ts";
import { type CardConfig, normalizeName } from "./cards.ts";
import { addDays, diffDays, type LocalDate } from "./date.ts";
import { type EntryInput, type EntryKind, type Placement, placeEntry } from "./entries.ts";
import type { Column, Ledger } from "./ledger.ts";
import { add, type Cents, cents, sub, ZERO } from "./money.ts";

/**
 * "Para lançar" (specs/005-lancamentos, Fase 2): what the bank showed and the sheet does not have
 * yet, already as the method writes it. Nothing here writes: each item only proposes, and the
 * owner launches, adjusts or ignores it. What is already planned in the sheet is corrected, not
 * repeated, and when it is not clear which line a movement stands for, the owner chooses.
 */

/** One line already in the sheet, as a change to it names it. */
export interface LineRef {
  readonly date: LocalDate;
  readonly column: Column;
  readonly section: string | null;
  readonly description: string;
  readonly amount: Cents;
}

/**
 * What launching does, in a form the owner can adjust (value, day, name) and the server can turn
 * back into placements, so the app never sends cells.
 * - `new`: a new entry, as typed by hand (`placeEntry`).
 * - `fix`: a line already planned gets the bank's value and day; with `also`, other lines change
 *   with it (the reimbursement of a card someone else pays).
 * - `card`: one card's bills set to the bank's totals.
 */
export type Draft =
  | ({ readonly type: "new" } & EntryInput)
  | {
      readonly type: "fix";
      readonly line: LineRef;
      readonly amount: Cents;
      readonly date: LocalDate;
      readonly description: string;
    }
  | {
      readonly type: "card";
      readonly card: string;
      readonly bills: readonly {
        readonly due: LocalDate;
        readonly was: Cents;
        readonly amount: Cents;
      }[];
      readonly also?: readonly { readonly line: LineRef; readonly amount: Cents }[];
    };

export type QueueKind =
  | "entrada"
  | "diario"
  | "conta"
  | "cartao"
  | "guardar"
  | "resgate"
  | "conta-propria";

export interface QueueOption {
  /** Empty for the only option; otherwise what this choice means, in the owner's words. */
  readonly label: string;
  readonly draft: Draft | null;
  /** For `conta-propria`: the answer to "where does this money go". */
  readonly answer?: "guardado" | "corrente";
}

export interface QueueItem {
  /** Stable across days, so an item ignored or launched does not come back. */
  readonly key: string;
  readonly kind: QueueKind;
  readonly date: LocalDate;
  /** What the bank showed, behind a tap. */
  readonly bank: readonly {
    readonly date: LocalDate;
    readonly amount: Cents;
    readonly description: string;
  }[];
  /** The first is what Lançar does; more than one means the owner chooses. */
  readonly options: readonly QueueOption[];
}

export interface QueueInput {
  readonly ledger: Ledger;
  readonly cards: readonly CardConfig[];
  readonly today: LocalDate;
  /** Movements older than this are history, not something to launch today. */
  readonly since: LocalDate;
  readonly movements: readonly BankMovement[];
  readonly lines: readonly BankCardLine[];
  readonly closed: readonly ClosedBill[];
  /** Cards someone else pays; their bill may move a planned reimbursement too. */
  readonly othersCards: readonly string[];
  /** Linked accounts and what the owner said each one is; unanswered ones are asked once. */
  readonly accounts: readonly {
    readonly id: string;
    readonly label: string;
    readonly use: "guardado" | "corrente" | null;
  }[];
  /** Origins (normalized bank text) the owner launched as savings before. */
  readonly savedOrigins: ReadonlySet<string>;
  /** Keys already launched or ignored. */
  readonly decided: ReadonlySet<string>;
}

/** How close a planned line's value must be for a movement to stand for it: a quarter. */
const NEAR_SHARE = 0.25;
/** A bill may go down before it closes only by this much: a cent of rounding on each parcel. */
const ROUNDING = 10;

/** Bank text without numbers and punctuation: "PIX RECEBIDO 0710 FULANO" → "pix recebido fulano". */
export const originKey = (description: string): string =>
  description
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();

/** A name fit for a note line: one line, no leading "R$", not too long. */
const lineName = (description: string): string => {
  const name = description
    .replace(/\s+/g, " ")
    .replace(/^r\$\s*/i, "")
    .trim()
    .slice(0, 40)
    .trim();
  return name === "" ? "Banco" : name;
};

const isCardSection = (s: string | null) =>
  s === "cartoes" || s === "cartao" || s === "faturas" || s === "fatura";

const near = (a: number, b: number) =>
  Math.abs(a - b) <= NEAR_SHARE * Math.max(Math.abs(a), Math.abs(b));

const ref = (l: SheetLine): LineRef => ({
  date: l.date,
  column: l.column,
  section: l.section,
  description: l.description,
  amount: cents(Math.abs(l.amount)),
});

/** Turns what launching does into cell changes; the server calls this, never the app. */
export const placeDraft = (draft: Draft, cards: readonly CardConfig[]): Placement[] => {
  if (draft.type === "new") return placeEntry(draft, cards);
  if (draft.type === "card")
    return [
      ...draft.bills
        .filter((b) => b.amount !== b.was)
        .map(
          (b): Placement => ({
            date: b.due,
            column: "saida",
            section: "cartoes",
            description: draft.card,
            target: "card",
            was: b.was,
            amount: b.amount,
          }),
        ),
      ...(draft.also ?? []).map((a) => lineChange(a.line, a.amount)),
    ];
  const { line } = draft;
  const description = draft.description.replace(/\s+/g, " ").trim();
  if (draft.date === line.date && normalizeName(description) === normalizeName(line.description))
    return [lineChange(line, draft.amount)];
  // A new day or a new name: the old line goes, the new one comes, in one entry.
  return [
    lineChange(line, ZERO),
    {
      date: draft.date,
      column: line.column,
      section: line.section,
      description,
      target: "line",
      amount: draft.amount,
    },
  ];
};

const lineChange = (line: LineRef, amount: Cents): Placement => ({
  date: line.date,
  column: line.column,
  section: line.section,
  description: line.description,
  target: "line",
  was: line.amount,
  amount,
});

/** What the method does with a movement nobody planned: Entrada, Diário, or savings. */
const newDraft = (m: BankMovement, kind: EntryKind, description: string): Draft => ({
  type: "new",
  kind,
  amount: cents(Math.abs(m.amount)),
  date: m.date,
  description,
});

export const buildQueue = (input: QueueInput): QueueItem[] => {
  const { ledger, today } = input;
  const days = new Set(ledger.map((r) => r.date));
  const use = new Map(input.accounts.map((a) => [a.id, a.use]));
  const label = new Map(input.accounts.map((a) => [a.id, a.label]));
  const savings = (account: string | undefined) =>
    account !== undefined && use.get(account) === "guardado";

  const matching = matchMovements(ledger, input.movements, today);
  // The names the owner already gives each origin in the sheet, the latest winning.
  const names = new Map<string, string>();
  for (const { movement, line } of [...matching.pairs].sort((a, b) =>
    a.line.date.localeCompare(b.line.date),
  ))
    if (line.description !== "") names.set(originKey(movement.description), line.description);
  const nameOf = (m: BankMovement) =>
    names.get(originKey(m.description)) ?? lineName(m.description);

  const items: QueueItem[] = [];
  const push = (item: QueueItem) => {
    if (!input.decided.has(item.key) && days.has(item.date)) items.push(item);
  };
  const free = matching.free
    .filter((l) => !isCardSection(l.section))
    .map((l) => ({ l, used: false }));
  const bankOf = (...ms: BankMovement[]) =>
    ms.map((m) => ({ date: m.date, amount: m.amount, description: m.description }));
  const inWindow = (m: BankMovement) => m.date >= input.since;

  for (const m of matching.unmatched) {
    if (!inWindow(m) || savings(m.account)) continue;
    const key = `mov:${m.id ?? `${m.account}|${m.date}|${m.amount}|${m.description}`}`;
    const bank = bankOf(m);

    if (m.amount > 0) {
      // A planned income: the salary arrives net of the deductions planned on its day.
      const deductions = (date: LocalDate) =>
        free.filter((f) => f.l.date === date && f.l.column === "saida");
      const found = free
        .filter(
          (f) =>
            !f.used &&
            f.l.column === "entrada" &&
            Math.abs(diffDays(f.l.date, m.date)) <= 7 &&
            near(f.l.amount - deductions(f.l.date).reduce((a, d) => a - d.l.amount, 0), m.amount),
        )
        .sort(
          (a, b) => Math.abs(diffDays(a.l.date, m.date)) - Math.abs(diffDays(b.l.date, m.date)),
        );
      const pick = found[0];
      if (pick) {
        pick.used = true;
        const cuts = deductions(pick.l.date);
        for (const c of cuts) c.used = true;
        const net = pick.l.amount + cuts.reduce((a, d) => a + d.l.amount, 0);
        const diff = m.amount - net;
        // Exactly the salary minus its deductions: nothing to launch.
        if (diff === 0 && pick.l.date === m.date) continue;
        const date = days.has(m.date) ? m.date : pick.l.date;
        push({
          key,
          kind: "entrada",
          date,
          bank,
          options: [
            {
              label: cuts.length > 0 && diff !== 0 ? pick.l.description : "",
              draft: {
                type: "fix",
                line: ref(pick.l),
                amount: cents(pick.l.amount + diff),
                date,
                description: pick.l.description,
              },
            },
            // Or a deduction changed: the salary stays, the deduction moves the other way.
            ...(diff === 0
              ? []
              : cuts
                  .filter((c) => -c.l.amount - diff > 0)
                  .map((c) => ({
                    label: c.l.description,
                    draft: {
                      type: "fix" as const,
                      line: ref(c.l),
                      amount: cents(-c.l.amount - diff),
                      date: c.l.date,
                      description: c.l.description,
                    },
                  }))),
          ],
        });
        continue;
      }
      push({
        key,
        kind: "entrada",
        date: m.date,
        bank,
        options: [{ label: "", draft: newDraft(m, "entrada", nameOf(m)) }],
      });
      continue;
    }

    if (input.savedOrigins.has(originKey(m.description))) {
      push({
        key,
        kind: "guardar",
        date: m.date,
        bank,
        options: [{ label: "", draft: newDraft(m, "reserva", nameOf(m)) }],
      });
      continue;
    }
    // A planned bill or payment, near in value and day: the planned line is corrected.
    const found = free
      .filter(
        (f) =>
          !f.used &&
          f.l.column === "saida" &&
          f.l.section !== "reserva" &&
          Math.abs(diffDays(f.l.date, m.date)) <= 7 &&
          near(f.l.amount, m.amount),
      )
      .sort(
        (a, b) =>
          Math.abs(a.l.amount - m.amount) - Math.abs(b.l.amount - m.amount) ||
          Math.abs(diffDays(a.l.date, m.date)) - Math.abs(diffDays(b.l.date, m.date)),
      );
    const best = found[0];
    if (best) {
      const tied = found.filter(
        (f) => Math.abs(f.l.amount - m.amount) === Math.abs(best.l.amount - m.amount),
      );
      for (const t of tied) t.used = true;
      const date = days.has(m.date) ? m.date : best.l.date;
      push({
        key,
        kind: "conta",
        date,
        bank,
        options: tied.map((t) => ({
          label: tied.length > 1 ? `${t.l.description} de ${t.l.date}` : "",
          draft: {
            type: "fix",
            line: ref(t.l),
            amount: cents(Math.abs(m.amount)),
            date,
            description: t.l.description,
          },
        })),
      });
      continue;
    }
    push({
      key,
      kind: "diario",
      date: m.date,
      bank,
      options: [{ label: "", draft: newDraft(m, "diario", nameOf(m)) }],
    });
  }

  // Money between the owner's accounts: nothing, unless one side is where he keeps savings.
  const sheetHas = (column: Column, amount: Cents, date: LocalDate) =>
    matching.free.some(
      (l) =>
        l.column === column &&
        l.section?.startsWith("reserva") &&
        Math.abs(l.amount) === amount &&
        Math.abs(diffDays(l.date, date)) <= 7,
    );
  const asked = new Set<string>();
  for (const t of matching.transfers) {
    if (!inWindow(t.in) || diffDays(t.in.date, today) < 0 || t.in.account === t.out.account)
      continue;
    const amount = cents(t.in.amount);
    const bank = bankOf(t.out, t.in);
    const into = t.in.account ?? "";
    if (savings(t.in.account) && !savings(t.out.account)) {
      if (sheetHas("saida", amount, t.out.date)) continue;
      push({
        key: `tr:${t.out.id ?? `${t.out.date}|${amount}`}`,
        kind: "guardar",
        date: t.out.date,
        bank,
        options: [
          {
            label: "",
            draft: {
              type: "new",
              kind: "reserva",
              amount,
              date: t.out.date,
              description: label.get(into) ?? "Reserva",
            },
          },
        ],
      });
    } else if (savings(t.out.account) && !savings(t.in.account)) {
      if (sheetHas("entrada", amount, t.in.date)) continue;
      push({
        key: `tr:${t.out.id ?? `${t.out.date}|${amount}`}`,
        kind: "resgate",
        date: t.in.date,
        bank,
        options: [
          {
            label: "",
            draft: {
              type: "new",
              kind: "resgate",
              amount,
              date: t.in.date,
              description: label.get(t.out.account ?? "") ?? "Reserva",
            },
          },
        ],
      });
    } else if (use.get(into) === null && !asked.has(into)) {
      asked.add(into);
      push({
        key: `conta:${into}`,
        kind: "conta-propria",
        date: t.in.date,
        bank,
        options: [
          { label: "Guardado", draft: null, answer: "guardado" },
          { label: "Só mudou de conta", draft: null, answer: "corrente" },
        ],
      });
    }
  }

  // Card bills: the line follows the bank's total, up always, down once the bill closed.
  const closed = new Set(input.closed.map((b) => `${normalizeName(b.card)}|${b.billMonth}`));
  const others = new Set(input.othersCards.map(normalizeName));
  const byCard = new Map<string, { due: LocalDate; was: Cents; amount: Cents }[]>();
  for (const c of billChecks(ledger, input.cards, input.lines, today, input.closed)) {
    const isClosed = closed.has(`${normalizeName(c.card)}|${c.due.slice(0, 7)}`);
    if (c.gap === 0 || (c.gap < 0 && !isClosed && -c.gap > ROUNDING)) continue;
    const bills = byCard.get(c.card) ?? [];
    bills.push({ due: c.due, was: c.sheet, amount: c.bank });
    byCard.set(c.card, bills);
  }
  for (const [card, bills] of byCard) {
    const first = bills[0];
    if (!first) continue;
    const draft: Draft = { type: "card", card, bills };
    // Someone else's card: the reimbursement planned on the due day, same name, may follow.
    const also = others.has(normalizeName(card))
      ? bills.flatMap((b) => {
          const line = ledger
            .find((r) => r.date === b.due)
            ?.entrada.items.filter((i) => normalizeName(i.description) === normalizeName(card));
          const one = line?.length === 1 ? line[0] : undefined;
          const amount = one ? one.amount + b.amount - b.was : 0;
          return one && amount >= 0
            ? [
                {
                  line: {
                    date: b.due,
                    column: "entrada" as const,
                    section: one.section,
                    description: one.description,
                    amount: one.amount,
                  },
                  amount: cents(amount),
                },
              ]
            : [];
        })
      : [];
    push({
      key: `card:${normalizeName(card)}:${bills.map((b) => `${b.due}=${b.amount}`).join(",")}`,
      kind: "cartao",
      date: first.due,
      bank: [],
      options:
        also.length > 0
          ? [
              { label: "Só a fatura", draft },
              { label: "Fatura e reembolso", draft: { ...draft, also } },
            ]
          : [{ label: "", draft }],
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
};

/** Yesterday's Saldo in the sheet against the money in the owner's accounts at the bank. */
export interface SaldoCheck {
  readonly date: LocalDate;
  readonly sheet: Cents;
  readonly bank: Cents;
  /** bank − sheet: positive means the sheet is missing money that is in the bank. */
  readonly diff: Cents;
  /** Banks not read today, whose balance may be old. */
  readonly stale: readonly string[];
}

export const saldoCheck = (
  ledger: Ledger,
  today: LocalDate,
  balances: readonly {
    readonly label: string;
    readonly balance: Cents;
    readonly readOn: LocalDate | null;
  }[],
): SaldoCheck | null => {
  const date = addDays(today, -1);
  const sheet = ledger.find((r) => r.date === date)?.saldo;
  if (sheet === null || sheet === undefined || balances.length === 0) return null;
  const bank = add(ZERO, ...balances.map((b) => b.balance));
  return {
    date,
    sheet,
    bank,
    diff: sub(bank, sheet),
    stale: [...new Set(balances.filter((b) => b.readOn !== today).map((b) => b.label))],
  };
};
