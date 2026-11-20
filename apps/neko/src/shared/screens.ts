import {
  add,
  addDays,
  type BillCheck,
  type BillState,
  billState,
  type CanSpend,
  type CardConfig,
  type Cents,
  type Change,
  cardOwner,
  cents,
  cycleForDueMonth,
  daysInMonth,
  diffDays,
  type Fixed,
  fixedOf,
  type Insight,
  type InstallmentPlan,
  type InstallmentSimulation,
  type InvoiceCard,
  installmentPlans,
  type LocalDate,
  markOf,
  monthWins,
  normalizeName,
  OPEN_BILL_MIN,
  type Outflow,
  type Owed,
  type OwnerMark,
  outflowTrend,
  owedOnBills,
  ownerKey,
  type Pace,
  type PhoneTrust,
  paceMonthly,
  partOf,
  type Reserve,
  type ReserveSteps,
  reserveSteps,
  type Saving,
  type ScenarioInput,
  type ScenarioResult,
  simulate,
  simulateInstallments,
  sub,
  type ThermoDay,
  type TrendPoint,
  theirsAfter,
  type Win,
  type YearTotals,
  ymd,
  ZERO,
} from "@neko/engine";
import { inMes, legacyPerDay } from "./today.ts";
import type { PrevistoView, ProjectionResponse, SubscriptionsView, UserSettings } from "./types.ts";

/**
 * Faturas, Mês and Ajustes ready to draw, for the Android app. Same rules as the site's screens
 * (web/screens/*.tsx): every filter, grouping and sort happens here, next to the tests, and the
 * app only formats.
 */

/** One line the bank has on a bill: a purchase, a refund or a parcel of an earlier purchase. */
export interface BankLineView {
  readonly description: string;
  readonly amount: number;
  /** The day of the charge; null in data read before it was kept. */
  readonly date: string | null;
  readonly installment: number | null;
  readonly installments: number | null;
  /** What a mark of someone else's holds on to; null for a refund or an old line. */
  readonly key: string | null;
  /** Whose it is, when marked as someone else's; null for yours. */
  readonly person: string | null;
  /** What that person pays of it: all of it, or their share when split; null for yours. */
  readonly part: number | null;
  /** A parcel's last bill, `yyyy-MM`; null for anything else. */
  readonly endsIn: string | null;
  /** Only on the bank's bill PDF: Open Finance left it out (or put it on another bill). */
  readonly fromStatement: boolean;
}

/** One card's bill in a month: the sheet's amount, where it stands, and what the bank has on it. */
export interface InvoiceRow {
  readonly card: string;
  readonly due: string;
  readonly closing: string;
  /** As the sheet holds it: the row's value. */
  readonly amount: number;
  readonly state: BillState;
  /** Days until it closes, today included; 0 unless open. */
  readonly closesInDays: number;
  readonly closingEstimated: boolean;
  readonly others: boolean;
  /** Whose card it is, for a card someone else pays, when a named person's name is in it. */
  readonly owner: string | null;
  readonly reimbursed: boolean;
  /**
   * Of the bank's lines, the owner's and each other person's part, when someone has one: the bar
   * "Seu" and "Lia" on the bill. Null when it is all the owner's.
   */
  readonly split: {
    readonly mine: number;
    readonly theirs: readonly { readonly person: string; readonly amount: number }[];
  } | null;
  /** The bank's side of this bill; null without a bank, or once it is due. */
  readonly bank: {
    readonly amount: number;
    readonly parcels: number;
    /** bank − sheet. */
    readonly gap: number;
    readonly closed: boolean;
    /** The sheet should change; the only bank detail the row itself shows. */
    readonly disagrees: boolean;
    /** Everything the bank has listed is parcels of earlier purchases, so far. */
    readonly onlyParcels: boolean;
    /** The last bill of the parcels on this one, `yyyy-MM`; null without parcels. */
    readonly parcelsUntil: string | null;
    readonly lines: readonly BankLineView[];
  } | null;
  /** The card's limit and what is free of it, as the bank last said; null without one. */
  readonly limit: { readonly limit: number; readonly available: number } | null;
  /** This card in each month shown, for its own history. */
  readonly history: readonly { readonly month: string; readonly amount: number }[];
}

/**
 * One person's part of a month's bills: their own card's bill, when they have one (`card`), and
 * their purchases on the owner's cards, each with the bill it is on. `total` is both.
 */
export interface OwedView extends Omit<Owed, "items"> {
  /** Their card's bill due that month, as the sheet holds it; null without one. */
  readonly card: { readonly card: string; readonly amount: number; readonly due: string } | null;
  readonly items: readonly (Omit<Owed["items"][number], "date"> & {
    readonly date: string | null;
    /** Its mark (see engine `ownerKey`), to change whose it is from here. */
    readonly key: string;
    /** The due day of the bill it is on; null when the bank has no bill for its card. */
    readonly due: string | null;
  })[];
  /** The last bill with a parcel of theirs, `yyyy-MM`, when parcels are still to come. */
  readonly until: string | null;
  /** Their part goes into the sheet when their Pix lands, not planned on the due day. */
  readonly onArrival: boolean;
}

/** Every card due in one month, with the month's total. */
export interface InvoiceMonthView {
  /** Due month, `yyyy-MM`. */
  readonly key: string;
  readonly total: number;
  /** Before today's month. */
  readonly past: boolean;
  /** After today's month: what the sheet already has, drawn as an outline. */
  readonly future: boolean;
  readonly cards: readonly InvoiceRow[];
  /** The month against the bank; null when the bank has none of its bills. */
  readonly bank: {
    /** Cards whose bill the bank disagrees with. */
    readonly disagree: number;
    /** Of the bank's amounts, parcels of earlier purchases and the rest. */
    readonly parcels: number;
    readonly fresh: number;
  } | null;
  /** Purchases on the month's bills marked as someone else's: what each will pay back. */
  readonly owed: readonly OwedView[];
}

/** Cards that charge a purchase made today on the same dates, read as one line. */
export interface BuyGroup {
  readonly cards: readonly string[];
  readonly payInDays: number;
  readonly due: string;
  /** Day after the closing, when a purchase waits the longest. */
  readonly bestDate: string;
  readonly estimated: boolean;
}

export interface InvoicesView {
  readonly today: string;
  readonly readAt: string;
  /** False when the sheet has no card at all. */
  readonly hasCards: boolean;
  /** Oldest first, each with the cards due in it. */
  readonly months: readonly InvoiceMonthView[];
  /** The month to open on: the next bill still to pay. */
  readonly current: string | null;
  /** Mean of the non-empty months before today's: the chart's dashed line. */
  readonly average: number | null;
  /** Longest wait first; empty with a single card of your own, where there is nothing to pick. */
  readonly buyToday: readonly BuyGroup[];
  /** How fresh the bank numbers are (see BankView.syncedAt); null with no bank linked. */
  readonly bank: { readonly syncedAt: string | null } | null;
  /** Monthly charges found on the bank, with the owner's marks to cancel; null with none. */
  readonly subscriptions: SubscriptionsView | null;
  /** Names already used for someone else's purchases, most recent first, to pick again. */
  readonly people: readonly string[];
  /** People whose part goes into the sheet when their Pix lands, not on the due day. */
  readonly onArrival: readonly string[];
  /** Every purchase in parcels (specs/008-parcelas); null with none. */
  readonly parcels: ParcelsView | null;
}

/** One purchase in parcels, as one side sees it: the owner's part, or one person's. */
export interface ParcelPlanView {
  /** What a mark of it holds on to, for "De quem é?"; null on someone else's card or with no store. */
  readonly key: string | null;
  readonly card: string;
  readonly description: string;
  readonly date: string | null;
  readonly installments: number;
  /** The parcel on the month's bills; 0 when its first one comes on a later bill. */
  readonly installment: number;
  /** The bills of its first and last parcels, `yyyy-MM`. */
  readonly first: string;
  readonly last: string;
  /** One parcel, as the bank charges it. */
  readonly amount: number;
  /** This side's part of one parcel. */
  readonly part: number;
  /** This side's part of the parcels before the month's. */
  readonly paid: number;
  /** This side's part from the month's parcel to the last. */
  readonly left: number;
  /** Whose it is, when someone else's (all of it or a share); null for the owner's own. */
  readonly person: string | null;
  /** Their part of each parcel, when split; null otherwise. */
  readonly share: number | null;
  /** On that person's own card, so the whole bill is theirs and there is nothing to mark. */
  readonly theirCard: boolean;
}

/** One month of parcels ahead: only what was already bought, so it only goes down. */
export interface ParcelMonthView {
  /** Due month, `yyyy-MM`. */
  readonly key: string;
  readonly amount: number;
  /** Of the month's own income, as a whole percent; null without an Entrada or for someone else. */
  readonly ofIncome: number | null;
  /** Of the ceiling in Ajustes, as a whole percent; null without one or for someone else. */
  readonly ofCeiling: number | null;
  /** Plans with a parcel on this month's bills. */
  readonly plans: number;
  /** Plans whose last parcel is on this month's bills. */
  readonly ending: readonly string[];
}

/** The owner's parcels, or one person's: Parcelas' filter. */
export interface ParcelSideView {
  /** Null for the owner's own. */
  readonly person: string | null;
  /** Plans with a parcel from the month on. */
  readonly count: number;
  /** On the month's bills. */
  readonly now: number;
  readonly ofIncome: number | null;
  readonly ofCeiling: number | null;
  /** The month before, when the bank listed its bills: its parcels, plans begun and ended since. */
  readonly previous: {
    readonly month: string;
    readonly amount: number;
    readonly started: number;
    readonly ended: number;
  } | null;
  /** Everything still to pay, the month's parcels included. */
  readonly left: number;
  /** The bill of the last parcel of all, `yyyy-MM`. */
  readonly last: string;
  /** From the month to `last`. */
  readonly months: readonly ParcelMonthView[];
  /** By the bill of their last parcel, soonest first; `frees` is what leaves the bills after it. */
  readonly groups: readonly {
    readonly last: string;
    readonly frees: number;
    readonly plans: readonly ParcelPlanView[];
  }[];
  /** Plans whose last parcel was on the month before's bills; null with none or no bank then. */
  readonly ended: {
    readonly month: string;
    readonly amount: number;
    readonly plans: readonly ParcelPlanView[];
  } | null;
}

export interface ParcelsView {
  /** The bills it is about, `yyyy-MM`: the next ones still to pay. */
  readonly month: string;
  /** The owner's first, when he has any; then each person's. */
  readonly sides: readonly ParcelSideView[];
  /** Bills still to pay whose sheet amount is short of the parcels the bank has on them. */
  readonly short: readonly {
    readonly card: string;
    readonly due: string;
    readonly missing: Cents;
  }[];
  /** What the sheet lacks on all of those bills together. */
  readonly shortBy: Cents;
  /** The owner's cards with a bill in the month and nothing from the bank to read parcels from. */
  readonly leftOut: readonly string[];
}

/** `2026-11` plus `n` months. */
const monthPlus = (month: string, n: number) => {
  const [y = 0, m = 1] = month.split("-").map(Number);
  const at = y * 12 + (m - 1) + n;
  return `${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, "0")}`;
};

/** The bill a plan's last parcel lands on, from a parcel on `billMonth`; null for no plan. */
const lastBill = (
  l: { installment: number | null; installments: number | null },
  billMonth: string,
) =>
  l.installment !== null && l.installments !== null && l.installments > 1
    ? monthPlus(billMonth, l.installments - l.installment)
    : null;

/** A bank card line for the screen: no card name (the row has it), no bill month (the month has it). */
const lineView = (l: BillCheck["lines"][number], owners: readonly OwnerMark[]): BankLineView => {
  // A later parcel answers to the mark made on its plan, so a change from here edits that mark.
  const mark = markOf(l, owners);
  return {
    description: l.description,
    amount: l.amount,
    date: l.date ?? null,
    installment: l.installment,
    installments: l.installments,
    key: mark?.key ?? ownerKey(l),
    person: mark?.person ?? null,
    part: mark ? partOf(l, mark) : null,
    endsIn: lastBill(l, l.billMonth),
    fromStatement: l.fromStatement ?? false,
  };
};

/** The owner's and each person's part of a bill's lines; null when all of it is his. */
const splitOf = (lines: readonly BankLineView[]): InvoiceRow["split"] => {
  const by = new Map<string, number>();
  for (const l of lines) if (l.person && l.part) by.set(l.person, (by.get(l.person) ?? 0) + l.part);
  if (by.size === 0) return null;
  const all = lines.reduce((sum, l) => sum + Math.max(0, l.amount), 0);
  const theirs = [...by]
    .map(([person, amount]) => ({ person, amount }))
    .sort((a, b) => b.amount - a.amount);
  return { mine: all - theirs.reduce((sum, t) => sum + t.amount, 0), theirs };
};

/** Months from `a` to `b`: 1 from one month to the next. */
const monthsFrom = (a: string, b: string) => {
  const [ya = 0, ma = 1] = a.split("-").map(Number);
  const [yb = 0, mb = 1] = b.split("-").map(Number);
  return yb * 12 + mb - (ya * 12 + ma);
};

/** `value` as a whole percent of `base`; null without a base. */
const percent = (value: number, base: number | null) =>
  base !== null && base > 0 ? Math.round((value * 100) / base) : null;

/**
 * Parcelas (specs/008-parcelas): every purchase in parcels from the next bills to pay on, the
 * owner's apart from each person's. For the owner, what they take of the month's income and of
 * the ceiling; for each, the months ahead with what was already bought, when each plan ends and
 * what that frees. Null when the bank shows no parcels.
 */
/** Every plan on the bills the bank listed, from `from` on; a card someone else pays is all theirs. */
const plansOf = (r: ProjectionResponse, people: readonly string[], from: string) =>
  installmentPlans(
    (r.bank?.checks ?? []).flatMap((c) => c.lines),
    from,
    r.bank?.owners ?? [],
    new Map(
      r.projection.cards
        .filter((c) => c.others)
        .map((c) => [normalizeName(c.card.name), cardOwner(c.card.name, people) ?? c.card.name]),
    ),
  );

const parcelsView = (
  r: ProjectionResponse,
  people: readonly string[],
  months: readonly InvoiceMonthView[],
): ParcelsView | null => {
  const p = r.projection;
  const checks = r.bank?.checks ?? [];
  const month = p.invoiceMonth ?? p.today.slice(0, 7);
  const prev = monthPlus(month, -1);
  const plans = plansOf(r, people, prev);
  const income = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    const own = p.months.find((x) => x.year === y && x.month === mo)?.ownIncome ?? 0;
    return own > 0 ? own : null;
  };
  const ceiling = p.canSpend?.budgetSource === "configured" ? p.canSpend.budget : null;
  // With the month before's bills listed, what began and ended since is known.
  const listedBefore = checks.some((c) => c.due.slice(0, 7) === prev && c.lines.length > 0);
  const persons = [...new Set(plans.flatMap((x) => (x.person === null ? [] : [x.person])))].sort(
    (a, b) => a.localeCompare(b),
  );
  const sides = [null, ...persons].flatMap((person): ParcelSideView[] => {
    const partAt = (plan: InstallmentPlan, m: string): number => {
      const b = plan.bills.find((x) => x.month === m);
      if (!b) return 0;
      if (person === null) return b.amount - b.theirs;
      return plan.person === person ? b.theirs : 0;
    };
    const sum = (list: readonly InstallmentPlan[], m: string) =>
      list.reduce((total, x) => total + partAt(x, m), 0);
    const ofSide = plans.filter((x) => x.bills.some((b) => partAt(x, b.month) > 0));
    const alive = ofSide.filter((x) => x.last >= month);
    const last = alive
      .map((x) => x.last)
      .sort()
      .at(-1);
    if (last === undefined) return [];
    const view = (plan: InstallmentPlan): ParcelPlanView => {
      // The month's parcel; the first, for a plan that starts later; the last, for one that ended.
      const at = plan.bills.find((b) => b.month >= month) ?? plan.bills.at(-1);
      const part = at ? partAt(plan, at.month) : 0;
      const done = Math.min(plan.installments, Math.max(0, monthsFrom(plan.first, month)));
      return {
        key: plan.key,
        card: plan.card,
        description: plan.description,
        date: plan.date,
        installments: plan.installments,
        installment: month < plan.first ? 0 : Math.min(plan.installments, done + 1),
        first: plan.first,
        last: plan.last,
        amount: at?.amount ?? 0,
        part,
        paid: part * done,
        left: plan.bills
          .filter((b) => b.month >= month)
          .reduce((total, b) => total + partAt(plan, b.month), 0),
        person: plan.person,
        share: plan.share,
        theirCard: plan.theirCard,
      };
    };
    const own = person === null;
    const now = sum(alive, month);
    const shown: ParcelMonthView[] = [];
    for (let m = month; m <= last; m = monthPlus(m, 1)) {
      const amount = sum(alive, m);
      shown.push({
        key: m,
        amount,
        ofIncome: own ? percent(amount, income(m)) : null,
        ofCeiling: own ? percent(amount, ceiling) : null,
        plans: alive.filter((x) => partAt(x, m) > 0).length,
        ending: alive.filter((x) => x.last === m).map((x) => x.description),
      });
    }
    const ended = ofSide.filter((x) => x.last === prev);
    const byPart = (a: ParcelPlanView, b: ParcelPlanView) =>
      b.part - a.part || a.description.localeCompare(b.description);
    return [
      {
        person,
        count: alive.length,
        now,
        ofIncome: own ? percent(now, income(month)) : null,
        ofCeiling: own ? percent(now, ceiling) : null,
        previous: listedBefore
          ? {
              month: prev,
              amount: sum(ofSide, prev),
              started: alive.filter((x) => x.first === month).length,
              ended: ended.length,
            }
          : null,
        left: alive.reduce((total, x) => total + view(x).left, 0),
        last,
        months: shown,
        groups: [...new Set(alive.map((x) => x.last))].sort().map((end) => {
          const group = alive.filter((x) => x.last === end);
          return { last: end, frees: sum(group, end), plans: group.map(view).sort(byPart) };
        }),
        ended:
          listedBefore && ended.length > 0
            ? { month: prev, amount: sum(ended, prev), plans: ended.map(view).sort(byPart) }
            : null,
      },
    ];
  });
  if (sides.length === 0) return null;
  const withPlans = new Set(plans.filter((x) => x.last >= month).map((x) => normalizeName(x.card)));
  const short = checks
    .filter(
      (c) =>
        c.due >= p.today &&
        withPlans.has(normalizeName(c.card)) &&
        c.parcels - c.sheet >= OPEN_BILL_MIN,
    )
    .map((c) => ({ card: c.card, due: c.due, missing: cents(c.parcels - c.sheet) }));
  return {
    month,
    sides,
    short,
    shortBy: short.reduce((total, x) => add(total, x.missing), ZERO),
    leftOut: (months.find((x) => x.key === month)?.cards ?? [])
      .filter(
        (c) =>
          !c.others &&
          c.amount > 0 &&
          (c.bank?.lines.length ?? 0) === 0 &&
          !withPlans.has(normalizeName(c.card)),
      )
      .map((c) => c.card),
  };
};

export const invoicesView = (r: ProjectionResponse): InvoicesView => {
  const p = r.projection;
  const today = p.today;
  const nowKey = today.slice(0, 7);
  // Your own cards in use: the usual one, an open bill, or a bill in the last months.
  const mine = p.cards
    .filter(
      (c) =>
        !c.others && (c.usual || c.onSheet !== 0 || p.bills.some((b) => b.card === c.card.name)),
    )
    .toSorted((a, b) => b.payInDays - a.payInDays);
  const groups: BuyGroup[] = [];
  for (const c of mine) {
    const at = groups.findIndex((g) => g.due === c.cycle.due && g.bestDate === c.bestDate);
    const g = groups[at];
    if (g)
      groups[at] = {
        ...g,
        cards: [...g.cards, c.card.name],
        estimated: g.estimated || c.card.closingEstimated,
      };
    else
      groups.push({
        cards: [c.card.name],
        payInDays: c.payInDays,
        due: c.cycle.due,
        bestDate: c.bestDate,
        estimated: c.card.closingEstimated,
      });
  }
  const checks = r.bank?.checks ?? [];
  const owners = r.bank?.owners ?? [];
  const limits = r.bank?.limits ?? [];
  const views = new Map(p.cards.map((c) => [normalizeName(c.card.name), c]));
  const invoices = p.invoices ?? [];
  // A card the bank already charges for a month the sheet has nothing on yet still shows up.
  const months = invoices.map((m) => {
    const sheetRows: InvoiceCard[] = [...m.cards];
    for (const c of checks) {
      if (c.due.slice(0, 7) !== m.month) continue;
      if (sheetRows.some((x) => normalizeName(x.card) === normalizeName(c.card))) continue;
      const view = views.get(normalizeName(c.card));
      if (!view) continue;
      const { card } = view;
      const [y = 0, mo = 0] = m.month.split("-").map(Number);
      const cycle = cycleForDueMonth(card, y, mo);
      const state = billState(cycle, today as LocalDate);
      sheetRows.push({
        card: card.name,
        cycle,
        amount: cents(0),
        state,
        closesInDays: state === "open" ? diffDays(today as LocalDate, cycle.closing) + 1 : 0,
        closingEstimated: card.closingEstimated,
        reimbursed: false,
        others: view.others,
      });
    }
    return { ...m, cards: sheetRows.toSorted((a, b) => a.cycle.due.localeCompare(b.cycle.due)) };
  });
  const people = [...new Set(owners.map((o) => o.person).reverse())];
  const waits = new Set((r.bank?.onArrival ?? []).map(normalizeName));
  // Each person's parcels still to come, the same as Parcelas counts them (spec 008).
  const plans = plansOf(r, people, months[0]?.month ?? nowKey);
  // Each person's part of a month's bills: their own card's bill, and their purchases on the
  // owner's cards with the bill each is on. Biggest first.
  const owedView = (
    rows: readonly InvoiceRow[],
    checks: readonly BillCheck[],
    month: string,
  ): OwedView[] => {
    const owed = owedOnBills(
      checks.flatMap((c) => c.lines ?? []),
      month,
      owners,
    );
    const cards = rows.filter((r) => r.owner !== null && r.amount > 0);
    const names = [...new Set([...owed.map((o) => o.person), ...cards.map((r) => r.owner ?? "")])];
    return names
      .map((person): OwedView => {
        const o = owed.find((x) => x.person === person);
        const card = cards.find((r) => r.owner === person);
        const items = (o?.items ?? []).map((i) => ({
          ...i,
          date: i.date ?? null,
          key:
            markOf({ ...i, billMonth: month }, owners)?.key ??
            ownerKey({ ...i, billMonth: month }) ??
            "",
          due: checks.find((c) => normalizeName(c.card) === normalizeName(i.card))?.due ?? null,
        }));
        const after = theirsAfter(plans, person, month);
        return {
          person,
          card: card ? { card: card.card, amount: card.amount, due: card.due } : null,
          total: cents((o?.total ?? 0) + (card?.amount ?? 0)),
          later: after.amount,
          lines: o?.lines ?? 0,
          items,
          until: after.until,
          onArrival: waits.has(normalizeName(person)),
        };
      })
      .sort((a, b) => b.total - a.total || a.person.localeCompare(b.person));
  };
  const historyOf = (card: string) =>
    months.map((m) => ({
      month: m.month,
      amount: m.cards.find((c) => normalizeName(c.card) === normalizeName(card))?.amount ?? 0,
    }));
  const monthViews = months.map((m): InvoiceMonthView => {
    const mine = checks.filter((c) => c.due.slice(0, 7) === m.month);
    const rows = m.cards.map((c): InvoiceRow => {
      const check = mine.find((x) => normalizeName(x.card) === normalizeName(c.card));
      const limit = limits.find((x) => normalizeName(x.card) === normalizeName(c.card));
      const lines = (check?.lines ?? []).map((l) => lineView(l, owners));
      return {
        card: c.card,
        due: c.cycle.due,
        closing: c.cycle.closing,
        amount: c.amount,
        state: c.state,
        closesInDays: c.closesInDays,
        closingEstimated: c.closingEstimated,
        others: c.others,
        owner: c.others ? cardOwner(c.card, people) : null,
        reimbursed: c.reimbursed,
        split: splitOf(lines),
        bank: check
          ? {
              amount: check.bank,
              parcels: check.parcels,
              gap: check.gap,
              closed: check.closed ?? false,
              disagrees: check.disagrees ?? check.gap > 0,
              onlyParcels: !check.closed && check.parcels > 0 && check.parcels === check.bank,
              parcelsUntil:
                lines
                  .map((l) => l.endsIn)
                  .filter((x): x is string => x !== null)
                  .sort()
                  .at(-1) ?? null,
              lines,
            }
          : null,
        limit: limit ? { limit: limit.limit, available: limit.available } : null,
        history: historyOf(c.card),
      };
    });
    const parcels = add(ZERO, ...mine.map((c) => c.parcels));
    return {
      key: m.month,
      total: m.total,
      past: m.month < nowKey,
      future: m.month > nowKey,
      cards: rows,
      bank:
        mine.length === 0
          ? null
          : {
              disagree: rows.filter((x) => x.bank?.disagrees).length,
              parcels,
              fresh: sub(add(ZERO, ...mine.map((c) => c.bank)), parcels),
            },
      owed: owedView(rows, mine, m.month),
    };
  });
  return {
    today,
    readAt: r.sheet.readAt,
    hasCards: p.cards.length > 0,
    months: monthViews,
    current: p.invoiceMonth ?? null,
    average: p.invoicesAverage ?? null,
    buyToday: mine.length > 1 ? groups : [],
    bank: r.bank ? { syncedAt: r.bank.syncedAt } : null,
    subscriptions: r.bank?.subscriptions?.items.length ? r.bank.subscriptions : null,
    people,
    onArrival: r.bank?.onArrival ?? [],
    parcels: parcelsView(r, people, monthViews),
  };
};

export interface MonthItem {
  /** `yyyy-MM`. */
  readonly key: string;
  readonly year: number;
  readonly month: number;
  /** Before the current month: closed, not a forecast. */
  readonly past: boolean;
  /** After the current month. */
  readonly future: boolean;
  readonly startBalance: number;
  readonly entrada: number;
  readonly saida: number;
  readonly diario: number;
  readonly endSheet: number;
  /** The method's performance; null on a month the sheet has no lines for. */
  readonly result: number | null;
  /**
   * Each destination with its last months, opened by a tap on its line, and its fixed line when it
   * comes back every month or is an installment.
   */
  readonly outflows: readonly (Outflow & {
    readonly trend: readonly TrendPoint[];
    readonly fixed: Fixed | null;
  })[];
  readonly fixed: readonly Fixed[];
  readonly fixedTotal: number;
  /** The termômetro: each day's balance and band, with what moved it. */
  readonly days: readonly ThermoDay[];
  /** Saída under a `Reserva:` header, its share of entradas (whole %, null without income). */
  readonly saved: number;
  readonly savedShare: number | null;
  /** The part of `saved` dated up to today: less than it while Reserva lines are still ahead. */
  readonly savedToDate: number;
  /** Saída plus diário minus what was saved. */
  readonly livingCost: number;
  /** The diário médio real: what a day cost, card bills included; null on a month ahead. */
  readonly dailyAverage: number | null;
  /** What a closed month achieved, as its recap showed it; empty for the others. */
  readonly wins: readonly Win[];
}

export interface MonthsView {
  readonly today: string;
  readonly readAt: string;
  /** The month to open on: today's, or the first one when the sheet does not reach today. */
  readonly current: string | null;
  readonly months: readonly MonthItem[];
  /** Next payday's saving: the termômetro marks its day in that month. */
  readonly saving: Saving | null;
  /** The emergency reserve; null before a month closed. */
  readonly reserve: Reserve | null;
  /** The reserve in steps, up to the method's 6 and 12 months; null without a reserve. */
  readonly steps: ReserveSteps | null;
  /** The Economia tab, one entry per year. */
  readonly years: readonly YearTotals[];
  /** Warnings that live here, not on Hoje: all on today's month, each also on its own. */
  readonly warnings: readonly Insight[];
}

const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

export const monthsView = (r: ProjectionResponse): MonthsView => {
  const p = r.projection;
  const nowKey = p.today.slice(0, 7);
  const months = p.months.map((m): MonthItem => {
    const key = monthKey(m.year, m.month);
    const moved = m.entrada !== 0 || m.saida !== 0 || m.diario !== 0;
    return {
      key,
      year: m.year,
      month: m.month,
      past: key < nowKey,
      future: key > nowKey,
      startBalance: m.startBalance,
      entrada: m.entrada,
      saida: m.saida,
      diario: m.diario,
      endSheet: m.endSheet,
      result: moved ? m.result : null,
      outflows: m.outflows.map((o) => ({
        ...o,
        trend: outflowTrend(p.months, m.year, m.month, o.label),
        fixed: fixedOf(o, m.fixed),
      })),
      fixed: m.fixed,
      fixedTotal: m.fixedTotal,
      days: m.days,
      saved: m.saved,
      savedShare: m.savedShare,
      savedToDate: m.savedToDate,
      livingCost: m.livingCost,
      // Missing on projections cached before it existed.
      dailyAverage: m.dailyAverage ?? null,
      wins: key < nowKey ? monthWins(p.months, m.year, m.month) : [],
    };
  });
  const current = months.find((m) => m.key === nowKey) ?? months[0];
  return {
    today: p.today,
    readAt: r.sheet.readAt,
    current: current?.key ?? null,
    months,
    saving: p.saving,
    reserve: p.reserve ?? null,
    steps: p.reserve ? reserveSteps(p.reserve) : null,
    years: p.years ?? [],
    warnings: (p.insights ?? []).filter(inMes),
  };
};

/**
 * Hoje's "Simular compra": a purchase of `amount` today on the usual card in `count` parcels, as
 * the site's simulator computes it. Null when the sheet has no usual card to put it on.
 */
export const simulateView = (
  r: ProjectionResponse,
  amount: Cents,
  count: number,
): (InstallmentSimulation & { readonly cycle: { readonly perDay: Cents } }) | null => {
  const cs = r.projection.canSpend;
  if (!cs) return null;
  const sim = simulateInstallments(cs, r.projection.months, amount, count);
  return {
    ...sim,
    cycle: { ...sim.cycle, perDay: legacyPerDay(sim.cycle.remaining, cs.daysLeft) },
  };
};

/** Simular's answer, with what the screen needs around it to ask the next one. */
export interface ScenarioView extends ScenarioResult {
  readonly today: LocalDate;
  /** When the sheet was read: the answer is only as fresh as that. */
  readonly readAt: string;
  /** The sheet's last day: nothing past it to simulate on. */
  readonly end: LocalDate;
  /** The usual card a purchase goes on, and the bill its first parcel lands on; null without one. */
  readonly card: string | null;
  readonly due: LocalDate | null;
  /** The paces this sheet and Ajustes allow, in the order they are offered. */
  readonly paces: readonly Pace[];
  /** What the ceiling and the last months' average spend a month, side by side; null without one. */
  readonly spends: { readonly teto: Cents | null; readonly media: Cents | null };
  /**
   * The first day the pace's spending counts, the start of next month: before it the sheet holds
   * the month, after it the pace is an assumption. Null for the sheet as it is.
   */
  readonly paceFrom: LocalDate | null;
  /**
   * The changes the engine refused (a day already gone, a purchase with no card), by their place
   * in the ask: the answer leaves them out and `effects` follows the others, in order.
   */
  readonly refused: readonly number[];
  /** Hoje's "Ainda cabem", as a purchase's own figure reads it, and the bill it measures. */
  readonly canSpend: Pick<CanSpend, "mode" | "left" | "overBy" | "due"> | null;
}

/** The ceiling needs Ajustes › Teto do mês; the average needs a full month before today. */
const paceSpends = (r: ProjectionResponse, ceiling: Cents | null) => {
  const p = r.projection;
  let media: Cents | null = null;
  try {
    media = paceMonthly("media", p.months, p.today, null);
  } catch {
    media = null;
  }
  return { teto: ceiling, media };
};

/**
 * What Simular and "Posso comprar?" read: the sheet's months, the usual card's next bill (where a
 * purchase's first parcel lands), the ceiling and Hoje's "Ainda cabem".
 */
export const scenarioInput = (r: ProjectionResponse, ceiling: Cents | null): ScenarioInput => {
  const p = r.projection;
  return {
    today: p.today,
    months: p.months,
    due: p.cards.find((c) => c.usual)?.cycle.due ?? null,
    ceiling,
    canSpend: p.canSpend,
  };
};

/**
 * Simular: the sheet's balances under a pace and what-ifs (engine `simulate`). Nothing is saved:
 * the same answer for the site, the Android app and Mia, computed on every ask. Without a pace,
 * or with one this sheet does not allow, it is the ceiling when there is one (the owner's own plan
 * for the months ahead), else the sheet as it is.
 */
export const scenarioView = (
  r: ProjectionResponse,
  ceiling: Cents | null,
  ask: { readonly pace?: Pace | undefined; readonly changes: readonly Change[] },
): ScenarioView => {
  const p = r.projection;
  const usual = p.cards.find((c) => c.usual) ?? null;
  const spends = paceSpends(r, ceiling);
  const paces: Pace[] = [
    "planilha",
    ...(spends.teto === null ? [] : ["teto" as const]),
    ...(spends.media === null ? [] : ["media" as const]),
  ];
  const pace =
    ask.pace && paces.includes(ask.pace) ? ask.pace : paces.includes("teto") ? "teto" : "planilha";
  const last = p.months.at(-1);
  const lastDay = last?.days.at(-1)?.day;
  const input = scenarioInput(r, ceiling);
  const run = (changes: readonly Change[]) => simulate(input, { pace, changes });
  // One change the engine refuses never takes the others with it: the answer without it, named.
  let refused: number[] = [];
  let result: ScenarioResult;
  try {
    result = run(ask.changes);
  } catch (e) {
    if (!(e instanceof RangeError) || ask.changes.length === 0) throw e;
    refused = ask.changes.flatMap((c, i) => {
      try {
        run([c]);
        return [];
      } catch {
        return [i];
      }
    });
    result = run(ask.changes.filter((_, i) => !refused.includes(i)));
  }
  const cs = p.canSpend;
  const [y, m] = p.today.split("-").map(Number) as [number, number];
  return {
    ...result,
    today: p.today,
    readAt: r.sheet.readAt,
    end: last && lastDay ? ymd(last.year, last.month, lastDay) : p.today,
    card: usual?.card.name ?? null,
    due: usual?.cycle.due ?? null,
    paces,
    spends,
    paceFrom: result.monthly === null ? null : addDays(ymd(y, m, daysInMonth(y, m)), 1),
    refused,
    canSpend: cs ? { mode: cs.mode, left: cs.left, overBy: cs.overBy, due: cs.due } : null,
  };
};

/**
 * Every pace's answer for the same what-ifs, the one Simular opens on first: Android asks once,
 * and a tap on a chip only picks among them instead of waiting on the Worker.
 */
export const scenarioViews = (
  r: ProjectionResponse,
  ceiling: Cents | null,
  changes: readonly Change[],
): ScenarioView[] => {
  const first = scenarioView(r, ceiling, { changes });
  return [
    first,
    ...first.paces
      .filter((pace) => pace !== first.pace)
      .map((pace) => scenarioView(r, ceiling, { pace, changes })),
  ];
};

export interface AjustesView {
  readonly settings: UserSettings;
  /** Cards found in the sheet, with the closing day in use (estimated when not set). */
  readonly cards: readonly CardConfig[];
  /** The diário in use when the setting is empty, shown as the field's placeholder. */
  readonly dailyAuto: number;
  /** The Diário previsto; null from a Worker that predates it. */
  readonly previsto: PrevistoView | null;
  /** Avisos de compra: how each bank app's reads fared against the bank (Android only). */
  readonly phone: readonly PhoneTrust[];
}

export const ajustesView = (r: ProjectionResponse, settings: UserSettings): AjustesView => ({
  settings,
  cards: r.cardsKnown,
  dailyAuto: r.projection.dailyForecast,
  previsto: r.previsto ?? null,
  phone: r.bank?.phone ?? [],
});
