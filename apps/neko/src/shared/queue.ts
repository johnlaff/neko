import {
  type CardConfig,
  type Cents,
  cents,
  type Draft,
  dropsForecast,
  forecastIn,
  isFreeDiario,
  isOnlyForecast,
  type Ledger,
  type LocalDate,
  originKey,
  type Placement,
  placeDraft,
  type QueueItem,
  type QueueKind,
  type SaldoCheck,
} from "@neko/engine";

/**
 * Para lançar, ready to draw (specs/005-lancamentos): each item in the sheet's own words, with
 * what each cell holds before and after. The web and the Android app only show these strings.
 */

export interface QueueOptionView {
  readonly label: string;
  /** Sent back as is to preview and launch; null for a question with no write. */
  readonly draft: Draft | null;
  readonly answer?: "guardado" | "corrente";
  /** One per cell, drawn as "Diário de 15/10: R$ 0,00 → R$ 18,90". Empty for a question. */
  readonly lines: readonly QueueLine[];
}

export interface QueueLine {
  /** "Diário de 15/10", "Fatura do Inter de 01/12", "Economia de out". */
  readonly label: string;
  /** Null for the Economia tab, which Neko does not read: `after` is then the change, signed. */
  readonly before: Cents | null;
  readonly after: Cents;
}

export interface QueueItemView {
  readonly key: string;
  readonly kind: QueueKind;
  readonly date: LocalDate;
  /** What the item is about, in the sheet's words: "Padaria", "Salário", "Inter". */
  readonly title: string;
  readonly options: readonly QueueOptionView[];
  /** What the bank showed, behind a tap. */
  readonly bank: QueueItem["bank"];
  /** Value, day and name can be changed before launching. */
  readonly adjustable: boolean;
  /** The bank text behind a single movement, normalized: launched as savings, it is remembered. */
  readonly origin: string | null;
}

export const dayMonth = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

const COLUMN: Record<Placement["column"], string> = {
  entrada: "Entrada",
  saida: "Saída",
  diario: "Diário",
};

const MONTHS = "jan fev mar abr mai jun jul ago set out nov dez".split(" ");

/**
 * The Diário previsto of many days, as one line: "Diário de 17/10: R$ 45,00 → R$ 0,00", or
 * "Diário de 365 dias: R$ 0,00 → R$ 16.425,00". Days the owner wrote in stay as they are.
 */
const forecastLine = (draft: Extract<Draft, { type: "forecast" }>, ledger: Ledger): QueueLine => {
  const wanted = new Set(draft.days);
  const rows = ledger.filter((r) => wanted.has(r.date));
  let before = 0;
  let after = 0;
  for (const { diario } of rows) {
    before += diario.amount;
    if (draft.value === 0) after += diario.amount - forecastIn(diario);
    else if (isFreeDiario(diario) || isOnlyForecast(diario)) after += draft.value;
    else after += diario.amount;
  }
  const [only] = draft.days;
  return {
    label:
      draft.days.length === 1 && only
        ? `Diário de ${dayMonth(only)}`
        : `Diário de ${draft.days.length} dias`,
    before: cents(before),
    after: cents(after),
  };
};

/** Each cell a draft changes, with its value now and after, in date order; Economia last. */
export const draftLines = (
  draft: Draft,
  ledger: Ledger,
  cards: readonly CardConfig[],
): QueueLine[] => {
  if (draft.type === "forecast") return [forecastLine(draft, ledger)];
  const cells = new Map<string, { p: Placement; before: Cents; delta: number }>();
  for (const p of placeDraft(draft, cards)) {
    const economia = p.target === "economia";
    const key = `${p.date}|${economia ? "economia" : p.column}`;
    const row = ledger.find((r) => r.date === p.date);
    const cell = cells.get(key) ?? { p, before: row?.[p.column].amount ?? (0 as Cents), delta: 0 };
    cell.delta += economia && p.column === "entrada" ? -p.amount : p.amount - (p.was ?? 0);
    // Real spending on a day with the Diário previsto takes the forecast off (see the writer).
    if (dropsForecast(p) && row) cell.delta -= forecastIn(row.diario);
    cells.set(key, cell);
  }
  return [...cells.values()]
    .sort(
      (a, b) =>
        Number(a.p.target === "economia") - Number(b.p.target === "economia") ||
        a.p.date.localeCompare(b.p.date),
    )
    .map(({ p, before, delta }): QueueLine => {
      if (p.target === "economia")
        return {
          label: `Economia de ${MONTHS[Number(p.date.slice(5, 7)) - 1]}`,
          before: null,
          after: cents(delta),
        };
      const what = p.target === "card" ? `Fatura do ${p.description}` : COLUMN[p.column];
      return { label: `${what} de ${dayMonth(p.date)}`, before, after: cents(before + delta) };
    });
};

const titleOf = (item: QueueItem): string => {
  const draft = item.options[0]?.draft;
  if (!draft) return "Conta nova sua";
  if (draft.type === "forecast")
    return draft.value > 0
      ? "Diário previsto"
      : draft.days.length === 1
        ? "Fechar o dia"
        : "Fechar os dias";
  if (draft.type === "card") return draft.card;
  if (draft.type === "fix") return draft.line.description;
  return draft.description;
};

export const queueView = (
  items: readonly QueueItem[],
  ledger: Ledger,
  cards: readonly CardConfig[],
): QueueItemView[] =>
  items.flatMap((item) => {
    try {
      return [
        {
          key: item.key,
          kind: item.kind,
          date: item.date,
          title: titleOf(item),
          options: item.options.map((o) => ({
            label: o.label,
            draft: o.draft,
            ...(o.answer ? { answer: o.answer } : {}),
            lines: o.draft ? draftLines(o.draft, ledger, cards) : [],
          })),
          bank: item.bank,
          adjustable: item.options.some(
            (o) => o.draft !== null && o.draft.type !== "card" && o.draft.type !== "forecast",
          ),
          origin:
            item.bank.length === 1 && item.bank[0] ? originKey(item.bank[0].description) : null,
        },
      ];
    } catch (error) {
      // A draft the engine cannot place is a bug, not a reason to hide the rest of the queue.
      console.error("queue item skipped", item.key, error);
      return [];
    }
  });

/** "Saldo bate", and the entry that would close the difference. */
export interface SaldoView extends SaldoCheck {
  /** Launches the difference on that day, as Entrada or Saída; the owner names it. */
  readonly draft: Draft | null;
}

export const saldoView = (s: SaldoCheck | null | undefined): SaldoView | null =>
  s
    ? {
        ...s,
        draft:
          s.diff === 0
            ? null
            : {
                type: "new",
                kind: s.diff > 0 ? "entrada" : "saida",
                amount: cents(Math.abs(s.diff)),
                date: s.date,
                description: "Diferença do banco",
              },
      }
    : null;
