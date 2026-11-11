import {
  type BankCardLine,
  type BankMovement,
  billChecks,
  type ClosedBill,
  linesBehind,
  MATCH_DAYS,
  matchMovements,
  originKey,
  originOf,
  party,
  type SheetLine,
} from "./bank.ts";
import { type CardConfig, normalizeName } from "./cards.ts";
import { addDays, clampedDay, diffDays, type LocalDate, parts } from "./date.ts";
import {
  type EntryInput,
  type EntryKind,
  type Placement,
  placeEntry,
  withEconomia,
} from "./entries.ts";
import { isFreeDiario } from "./forecast.ts";
import { type Column, forecastIn, type Ledger } from "./ledger.ts";
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
 * - `forecast`: the Diário previsto of these days becomes `value` (0 takes it away). Days whose
 *   Diário the owner wrote are left as they are.
 * - `advance`: part of a planned payback came early (see the Draft).
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
    }
  | {
      readonly type: "forecast";
      readonly value: Cents;
      readonly days: readonly LocalDate[];
    }
  | {
      /**
       * Money someone sends ahead of the planned payback of the card they use: an Entrada named
       * after the card on its day, and `payback` goes down by as much (never below zero).
       */
      readonly type: "advance";
      readonly amount: Cents;
      readonly date: LocalDate;
      readonly description: string;
      readonly payback: LineRef;
    };

/** A draft that becomes a few cell changes; the Diário previsto has its own writer. */
export type CellDraft = Exclude<Draft, { type: "forecast" }>;

export type QueueKind =
  | "entrada"
  | "diario"
  | "conta"
  | "cartao"
  | "guardar"
  | "resgate"
  | "conta-propria"
  | "previsto";

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
  /** For `conta-propria`: the name of the account asked about. */
  readonly account?: string;
  /** For a card: the bank's lines behind each bill that changes (`BillPurchases`). */
  readonly purchases?: readonly BillPurchases[];
}

/**
 * Why a bill changes, as the bank shows it: the lines that add up to the change (`exact`), newest
 * first, or, when none do, the newest on the bill. A parcel already shown on an earlier bill of
 * the same item is left out, so a new purchase in ten parcels reads once.
 */
export interface BillPurchases {
  readonly due: LocalDate;
  readonly exact: boolean;
  /** What the lines add up to: the bill's change when `exact`. */
  readonly total: Cents;
  readonly lines: readonly BankCardLine[];
}

/** When no lines add up to a rise, this many of the newest stand in for them. */
const NEWEST_SHOWN = 3;

const newestOf = (lines: readonly BankCardLine[]): BankCardLine[] =>
  lines
    .filter((l) => l.date)
    .toSorted((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, NEWEST_SHOWN);

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
  /** The ignored ones: on an open card bill, what the bank had above the sheet then stays out. */
  readonly ignored?: ReadonlySet<string>;
  /** The Diário previsto, when the owner turned it on: its value per day. */
  readonly forecast?: Cents | null;
  /** Bills that came by e-mail before they are paid. */
  readonly mailed?: readonly MailedConta[];
}

/** A bill the biller e-mailed (light, phone): its value and due day, known before it is paid. */
export interface MailedConta {
  /** Who sent it, as its e-mail names it: what the bank or the sheet also call it. */
  readonly biller: string;
  readonly due: LocalDate;
  readonly total: Cents;
  /** The day the e-mail came: a payment to the biller from then on is this bill's. */
  readonly arrived: LocalDate;
}

/** How close a planned line's value must be for a movement to stand for it: a quarter. */
const NEAR_SHARE = 0.25;
/** Looser when the sheet already calls this origin by the planned line's name: half. */
const NAMED_SHARE = 0.5;

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

const near = (a: number, b: number, share = NEAR_SHARE) =>
  Math.abs(a - b) <= share * Math.max(Math.abs(a), Math.abs(b));

/** Whether two names share a word of three letters or more: "Vivo" and "Fatura Vivo" do. */
const sharesWord = (a: string, b: string) => {
  const words = new Set(
    originKey(a)
      .split(" ")
      .filter((w) => w.length >= 3),
  );
  return originKey(b)
    .split(" ")
    .some((w) => w.length >= 3 && words.has(w));
};

const ref = (l: SheetLine): LineRef => ({
  date: l.date,
  column: l.column,
  section: l.section,
  description: l.description,
  amount: cents(Math.abs(l.amount)),
});

/** Turns what launching does into cell changes; the server calls this, never the app. */
export const placeDraft = (draft: CellDraft, cards: readonly CardConfig[]): Placement[] => {
  if (draft.type === "new") return placeEntry(draft, cards);
  if (draft.type === "card")
    return withEconomia([
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
    ]);
  if (draft.type === "advance")
    return withEconomia([
      {
        date: draft.date,
        column: "entrada",
        section: draft.payback.section,
        description: draft.description.replace(/\s+/g, " ").trim(),
        target: "line",
        amount: draft.amount,
      },
      lineChange(draft.payback, cents(Math.max(0, draft.payback.amount - draft.amount))),
    ]);
  const { line } = draft;
  const description = draft.description.replace(/\s+/g, " ").trim();
  if (draft.date === line.date && normalizeName(description) === normalizeName(line.description))
    return withEconomia([lineChange(line, draft.amount)]);
  // A new day or a new name: the old line goes, the new one comes, in one entry.
  return withEconomia([
    lineChange(line, ZERO),
    {
      date: draft.date,
      column: line.column,
      section: line.section,
      description,
      target: "line",
      amount: draft.amount,
    },
  ]);
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

/** A card item's key: the card (normalized) and each bill it moves, from the sheet's value to its. */
const CARD_KEY = /^card:(.+?):(\d{4}-\d{2}-\d{2}=-?\d+>-?\d+(?:,\d{4}-\d{2}-\d{2}=-?\d+>-?\d+)*)/;

/**
 * Ignoring a card item says the bank's rise on those bills is not real (a credit the feed left
 * out, a charge the bank will cancel): per `card|due`, how much of the bank's total to leave out.
 * Ignored again later, the new rise adds to it.
 */
export const ignoredGaps = (keys: Iterable<string>): Map<string, Cents> => {
  const out = new Map<string, Cents>();
  for (const key of keys) {
    const [, card, bills] = CARD_KEY.exec(key) ?? [];
    if (!card || !bills) continue;
    for (const bill of bills.split(",")) {
      const [due = "", values = ""] = bill.split("=");
      const [was = 0, amount = 0] = values.split(">").map(Number);
      const at = `${card}|${due}`;
      out.set(at, cents((out.get(at) ?? 0) + amount - was));
    }
  }
  return out;
};

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
  // Who already pays each planned name: a line always paid to the teacher is not taken for a
  // purchase of near value somewhere else.
  const payers = new Map<string, Set<string>>();
  for (const { movement, line } of matching.pairs) {
    const name = normalizeName(line.description);
    payers.set(name, (payers.get(name) ?? new Set()).add(originOf(movement.description)));
  }
  const othersPay = (l: SheetLine, m: BankMovement) =>
    payers.get(normalizeName(l.description))?.has(originOf(m.description)) === false;

  // Someone else's card is paid back by an Entrada of the same name on the due day: one line.
  // Money they send before it is an Entrada of that name too, and the payback is what is left.
  const others = new Set(input.othersCards.map(normalizeName));
  const isPayback = (l: SheetLine) =>
    l.column === "entrada" && others.has(normalizeName(l.description));
  // Who already paid a card back: the next Pix from them is a payback first.
  const paysBack = new Set(
    matching.pairs.filter((p) => isPayback(p.line)).map((p) => originOf(p.movement.description)),
  );
  // Or a person whose name starts like a word of the card's: "Gio" in "Banco Gio".
  const looksLike = (card: string, m: BankMovement) => {
    const words = normalizeName(card)
      .split(" ")
      .filter((w) => w.length >= 3);
    return (party(m.description) ?? "").split(" ").some((p) => words.some((w) => p.startsWith(w)));
  };
  // The next payback still planned after the money came: what an early Pix pays part of.
  const paybackAhead = (m: BankMovement) =>
    matching.free
      .filter(
        (l) =>
          isPayback(l) &&
          l.date > m.date &&
          l.amount >= m.amount &&
          isCardDue(l) &&
          (paysBack.has(originOf(m.description)) || looksLike(l.description, m)),
      )
      .sort((a, b) => a.date.localeCompare(b.date))[0];
  const isCardDue = (l: SheetLine) =>
    ledger
      .find((r) => r.date === l.date)
      ?.saida.items.some(
        (i) =>
          isCardSection(i.section) && normalizeName(i.description) === normalizeName(l.description),
      ) ?? false;

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
  const movKey = (m: BankMovement) =>
    `mov:${m.id ?? `${m.account}|${m.date}|${m.amount}|${m.description}`}`;

  // Moved by the bank days before the planned day, with the same value: the Saldo is off until
  // that day, so the planned line moves to the bank's day while that day is still ahead. Not a
  // card's bill or its payback, whose lines stay on the due day.
  for (const { movement: m, line } of matching.pairs) {
    if (
      !inWindow(m) ||
      savings(m.account) ||
      m.date >= line.date ||
      line.date < today ||
      !days.has(m.date) ||
      line.column === "diario" ||
      line.section === "reserva" ||
      isCardSection(line.section) ||
      (line.column === "entrada" && others.has(normalizeName(line.description)))
    )
      continue;
    push({
      key: movKey(m),
      kind: line.column === "entrada" ? "entrada" : "conta",
      date: m.date,
      bank: bankOf(m),
      options: [
        {
          label: "",
          draft: {
            type: "fix",
            line: ref(line),
            amount: cents(Math.abs(m.amount)),
            date: m.date,
            description: line.description,
          },
        },
      ],
    });
  }

  for (const m of matching.unmatched) {
    if (!inWindow(m) || savings(m.account)) continue;
    const key = movKey(m);
    const bank = bankOf(m);

    if (m.amount > 0) {
      // A planned income: the salary arrives net of the deductions planned on its day, or whole
      // when the bank debits them apart (a class paid that day is no deduction): the closer one.
      const planned = (f: (typeof free)[number]) => {
        const cuts = free.filter((d) => d.l.date === f.l.date && d.l.column === "saida");
        const net = f.l.amount + cuts.reduce((a, d) => a + d.l.amount, 0);
        return Math.abs(m.amount - net) <= Math.abs(m.amount - f.l.amount)
          ? { cuts, net }
          : { cuts: [], net: f.l.amount };
      };
      const found = free
        .filter(
          (f) =>
            !f.used &&
            f.l.column === "entrada" &&
            !othersPay(f.l, m) &&
            Math.abs(diffDays(f.l.date, m.date)) <= 7 &&
            near(planned(f).net, m.amount),
        )
        .sort(
          (a, b) => Math.abs(diffDays(a.l.date, m.date)) - Math.abs(diffDays(b.l.date, m.date)),
        );
      const pick = found[0];
      if (pick) {
        pick.used = true;
        const { cuts, net } = planned(pick);
        for (const c of cuts) c.used = true;
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
      const plain = newDraft(m, "entrada", nameOf(m));
      const back = party(m.description) === null ? undefined : paybackAhead(m);
      push({
        key,
        kind: "entrada",
        date: m.date,
        bank,
        options: back
          ? [
              {
                label: "Reembolso adiantado",
                draft: {
                  type: "advance",
                  amount: cents(m.amount),
                  date: m.date,
                  description: back.description,
                  payback: ref(back),
                },
              },
              { label: "Entrada nova", draft: plain },
            ]
          : [{ label: "", draft: plain }],
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
    // A planned bill or payment, near in value and day: the planned line is corrected. Not one
    // whose name has nothing in common with what the sheet already calls this origin; one that
    // shares it may be further off in value (a tuition planned below the real boleto).
    const known = names.get(originKey(m.description));
    const found = free
      .filter(
        (f) =>
          !f.used &&
          f.l.column === "saida" &&
          f.l.section !== "reserva" &&
          (known === undefined || sharesWord(known, f.l.description)) &&
          !othersPay(f.l, m) &&
          Math.abs(diffDays(f.l.date, m.date)) <= 7 &&
          near(f.l.amount, m.amount, known === undefined ? NEAR_SHARE : NAMED_SHARE),
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
      // Only the line taken: the other tied one stays free for a second payment.
      best.used = true;
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

  // A bill that came by e-mail and is not paid yet: the line the sheet plans for it takes its
  // value, so the Saldo ahead is right before the money moves; with none planned, it goes on its
  // due day. Once the bank shows the payment, or the day passes, the bank says what happened.
  for (const b of input.mailed ?? []) {
    const words = new Set(
      originKey(b.biller)
        .split(" ")
        .filter((w) => w.length >= 3),
    );
    const named = (text: string) =>
      originKey(text)
        .split(" ")
        .some((w) => words.has(w));
    // What the sheet calls the bills paid to this biller before, the latest last.
    const called = matching.pairs
      .filter((p) => p.line.column === "saida" && p.line.description !== "")
      .filter((p) => named(p.movement.description))
      .map((p) => p.line)
      .sort((x, y) => x.date.localeCompare(y.date))
      .map((l) => l.description);
    const theirs = new Set(called.map(normalizeName));
    const planned = (l: SheetLine) =>
      l.column === "saida" &&
      !isCardSection(l.section) &&
      l.section !== "reserva" &&
      (named(l.description) || theirs.has(normalizeName(l.description))) &&
      Math.abs(diffDays(l.date, b.due)) <= MATCH_DAYS;
    // Paid since the e-mail came: to the biller by name, of the bill's exact value, or matched to
    // the line planned for it (the bank may call the biller something else).
    const paid =
      input.movements.some(
        (m) =>
          m.amount < 0 && m.date >= b.arrived && (named(m.description) || m.amount === -b.total),
      ) || matching.pairs.some((p) => p.movement.date >= b.arrived && planned(p.line));
    if (b.due < today || paid) continue;
    const line = matching.free
      .filter(planned)
      .sort((x, y) => Math.abs(diffDays(x.date, b.due)) - Math.abs(diffDays(y.date, b.due)))[0];
    if (line && -line.amount === b.total) continue;
    // A payment already corrects that line: one item for it, the bank's.
    const fixed = (d: Draft | null) =>
      d?.type === "fix" &&
      line !== undefined &&
      d.line.date === line.date &&
      d.line.column === line.column &&
      d.line.description === line.description;
    if (items.some((i) => i.options.some((o) => fixed(o.draft)))) continue;
    const description = line?.description ?? called.at(-1) ?? b.biller;
    const date = line?.date ?? b.due;
    push({
      key: `mail:${normalizeName(b.biller)}:${b.due}:${b.total}`,
      kind: "conta",
      date,
      bank: [{ date: b.due, amount: cents(-b.total), description: `Conta ${b.biller} por e-mail` }],
      options: [
        {
          label: "",
          draft: line
            ? { type: "fix", line: ref(line), amount: b.total, date, description }
            : { type: "new", kind: "conta", amount: b.total, date, description },
        },
      ],
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
        account: label.get(into) ?? "Banco",
        options: [
          { label: "Guarda", draft: null, answer: "guardado" },
          { label: "Dia a dia", draft: null, answer: "corrente" },
        ],
      });
    }
  }

  // Card bills: the line follows the bank's total, up always, down once the bill closed.
  // What someone sent for a bill before its due day, since the previous one: the payback is the rest.
  const ahead = (card: string, due: LocalDate) => {
    const { year, month, day } = parts(due);
    const from = clampedDay(year, month - 1, day);
    return add(
      ZERO,
      ...ledger
        .filter((r) => r.date > from && r.date < due)
        .flatMap((r) => r.entrada.items)
        .filter((i) => normalizeName(i.description) === normalizeName(card))
        .map((i) => i.amount),
    );
  };
  const rest = (card: string, due: LocalDate, bill: Cents) =>
    cents(Math.max(0, bill - ahead(card, due)));
  const payback = (card: string, due: LocalDate) => {
    if (!others.has(normalizeName(card))) return undefined;
    const lines = ledger
      .find((r) => r.date === due)
      ?.entrada.items.filter((i) => normalizeName(i.description) === normalizeName(card));
    return lines?.length === 1 ? lines[0] : undefined;
  };
  const byCard = new Map<string, { due: LocalDate; was: Cents; amount: Cents }[]>();
  const onBill = new Map<string, readonly BankCardLine[]>();
  const gaps = ignoredGaps(input.ignored ?? []);
  for (const c of billChecks(
    ledger,
    input.cards,
    input.lines,
    today,
    input.closed,
    undefined,
    gaps,
  )) {
    // The same rule that marks the bill on Faturas, so every warning there has its item here.
    const moves = c.disagrees;
    // The bank's total, less what the owner ignored on this open bill.
    const amount = moves ? add(c.sheet, c.gap) : c.sheet;
    // A payback that differs from its bill is worth fixing even when the bill itself is right.
    const back = payback(c.card, c.due);
    if (!moves && (!back || back.amount === rest(c.card, c.due, amount))) continue;
    const bills = byCard.get(c.card) ?? [];
    bills.push({ due: c.due, was: c.sheet, amount });
    byCard.set(c.card, bills);
    onBill.set(`${c.card}|${c.due}`, c.lines);
  }
  for (const [card, bills] of byCard) {
    const first = bills[0];
    if (!first) continue;
    const draft: Draft = { type: "card", card, bills };
    // The payback follows the whole bill, not just the change: Gio pays back what her card spent.
    const also = bills.flatMap((b) => {
      const one = payback(card, b.due);
      const left = rest(card, b.due, b.amount);
      return one && one.amount !== left
        ? [
            {
              line: {
                date: b.due,
                column: "entrada" as const,
                section: one.section,
                description: one.description,
                amount: one.amount,
              },
              amount: left,
            },
          ]
        : [];
    });
    const billChanges = bills.some((b) => b.amount !== b.was);
    // A parcel reads once: the same purchase on a later bill is the same news.
    const shown = new Set<string>();
    const purchases = bills.flatMap((b): BillPurchases[] => {
      const gap = sub(b.amount, b.was);
      const all = onBill.get(`${card}|${b.due}`) ?? [];
      const behind = linesBehind(all, gap);
      const lines = (behind ?? (gap > 0 ? newestOf(all) : [])).filter((l) => {
        if ((l.installments ?? 1) <= 1) return true;
        const key = `${originKey(l.description)}|${l.installments}|${l.amount}`;
        if (shown.has(key)) return false;
        shown.add(key);
        return true;
      });
      const total = add(ZERO, ...lines.map((l) => l.amount));
      return lines.length > 0 ? [{ due: b.due, exact: behind !== null, total, lines }] : [];
    });
    push({
      // A payback left behind after "Só a fatura" is a new item, not the bill already decided.
      key: `card:${normalizeName(card)}:${bills.map((b) => `${b.due}=${b.was}>${b.amount}`).join(",")}${billChanges ? "" : ":reembolso"}`,
      kind: "cartao",
      date: first.due,
      bank: [],
      ...(purchases.length > 0 ? { purchases } : {}),
      // Someone else's card is paid back: that is what Lançar does, "Só a fatura" is the choice.
      options: !billChanges
        ? [{ label: "", draft: { ...draft, also } }]
        : also.length > 0
          ? [
              { label: "Fatura e reembolso", draft: { ...draft, also } },
              { label: "Só a fatura", draft },
            ]
          : [{ label: "", draft }],
    });
  }
  // The Diário previsto: a day that passed loses its forecast, keeping only what was really
  // spent (0 when everything went on a card). A day with a Pix still to launch waits for it,
  // since launching the Pix takes the forecast off too.
  const pixDays = new Set(items.filter((i) => i.kind === "diario").map((i) => i.date));
  const passed = ledger
    .filter((r) => r.date < today && forecastIn(r.diario) > 0 && !pixDays.has(r.date))
    .map((r) => r.date);
  const firstPassed = passed[0];
  if (firstPassed)
    push({
      key: `previsto:fechar:${passed.join(",")}`,
      kind: "previsto",
      date: firstPassed,
      bank: [],
      options: [{ label: "", draft: { type: "forecast", value: ZERO, days: passed } }],
    });
  // Days ahead with nothing in the Diário, like a new year tab: they get the forecast too.
  const value = input.forecast ?? 0;
  const empty = value > 0 ? ledger.filter((r) => r.date >= today && isFreeDiario(r.diario)) : [];
  const firstEmpty = empty[0];
  const lastEmpty = empty.at(-1);
  if (firstEmpty && lastEmpty)
    push({
      key: `previsto:preencher:${value}:${firstEmpty.date}:${lastEmpty.date}:${empty.length}`,
      kind: "previsto",
      date: firstEmpty.date,
      bank: [],
      options: [
        {
          label: "",
          draft: { type: "forecast", value: cents(value), days: empty.map((r) => r.date) },
        },
      ],
    });
  // What changes the sheet first, by date; questions about an account last.
  const question = (i: QueueItem) => Number(i.kind === "conta-propria");
  return items.sort(
    (a, b) =>
      question(a) - question(b) || a.date.localeCompare(b.date) || a.key.localeCompare(b.key),
  );
};

/** A planned Entrada or Saída the sheet already counts and the bank has not moved yet. */
export interface SaldoWaiting {
  readonly date: LocalDate;
  readonly column: "entrada" | "saida";
  /** As in the sheet; a card's bill reads "Fatura" and the card. */
  readonly description: string;
  /** As in the sheet, positive. */
  readonly amount: Cents;
}

/** Yesterday's Saldo in the sheet against the money in the owner's accounts at the bank. */
export interface SaldoCheck {
  readonly date: LocalDate;
  readonly sheet: Cents;
  readonly bank: Cents;
  /** bank − sheet: positive means the sheet is missing money that is in the bank. */
  readonly diff: Cents;
  /** Banks not read today, whose balance may be old. */
  readonly stale: readonly string[];
  /** The lines that are the whole difference, when it is only the bank being late; else none. */
  readonly waiting: readonly SaldoWaiting[];
}

/** How many planned lines are tried together to make up the difference. */
const WAITING_MAX = 10;

/**
 * Planned lines of the last MATCH_DAYS days up to `date` that no movement stands for yet, whose
 * sum is the difference: a class planned on payday and paid by Pix days later leaves the money
 * in the bank meanwhile, and so does a card bill due on a weekend or holiday. The fewest lines
 * that make it up win.
 */
const waitingLines = (
  ledger: Ledger,
  movements: readonly BankMovement[],
  today: LocalDate,
  date: LocalDate,
  diff: Cents,
): SaldoWaiting[] => {
  if (diff === 0) return [];
  // What the bank moved after `date` was still in the account then: a class paid today was
  // waiting yesterday.
  const moved = movements.filter((m) => diffDays(m.date, date) >= 0);
  // Bill payments never pair with a sheet line, so a card's bill stays free once paid too: it is
  // paid when a debit within MATCH_DAYS is its amount, or all that day's bills in one go.
  const billPaid = (l: SheetLine) => {
    const day = ledger.find((r) => r.date === l.date)?.saida.items ?? [];
    const allBills = cents(
      -add(ZERO, ...day.filter((i) => isCardSection(i.section)).map((i) => i.amount)),
    );
    return moved.some(
      (m) =>
        m.amount < 0 &&
        Math.abs(diffDays(l.date, m.date)) <= MATCH_DAYS &&
        (m.amount === l.amount || m.amount === allBills),
    );
  };
  const lines = matchMovements(ledger, moved, today)
    .free.filter(
      (l) =>
        l.column !== "diario" &&
        !(isCardSection(l.section) && billPaid(l)) &&
        l.section !== "reserva" &&
        diffDays(l.date, date) >= 0 &&
        diffDays(l.date, date) < MATCH_DAYS,
    )
    .slice(-WAITING_MAX);
  const bits = (n: number) => n.toString(2).replaceAll("0", "").length;
  const masks = Array.from({ length: 2 ** lines.length - 1 }, (_, i) => i + 1).sort(
    (a, b) => bits(a) - bits(b) || a - b,
  );
  for (const mask of masks) {
    const pick = lines.filter((_, i) => mask & (1 << i));
    // A Saída the bank has not paid yet leaves more in the bank than the sheet says.
    if (pick.reduce((s, l) => s - l.amount, 0) === diff)
      return pick.map((l) => ({
        date: l.date,
        column: l.column === "entrada" ? "entrada" : "saida",
        description:
          isCardSection(l.section) && !/^fatura\b/i.test(l.description)
            ? `Fatura ${l.description}`
            : l.description,
        amount: cents(Math.abs(l.amount)),
      }));
  }
  return [];
};

export const saldoCheck = (
  ledger: Ledger,
  today: LocalDate,
  balances: readonly {
    readonly label: string;
    readonly balance: Cents;
    readonly readOn: LocalDate | null;
    /** What the account moved today: in the balance, not yet in yesterday's Saldo. */
    readonly today?: Cents;
  }[],
  movements: readonly BankMovement[] = [],
): SaldoCheck | null => {
  const date = addDays(today, -1);
  const sheet = ledger.find((r) => r.date === date)?.saldo;
  if (sheet === null || sheet === undefined || balances.length === 0) return null;
  const bank = add(ZERO, ...balances.map((b) => sub(b.balance, b.today ?? ZERO)));
  const diff = sub(bank, sheet);
  return {
    date,
    sheet,
    bank,
    diff,
    stale: [...new Set(balances.filter((b) => b.readOn !== today).map((b) => b.label))],
    waiting: waitingLines(ledger, movements, today, date, diff),
  };
};
