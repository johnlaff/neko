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

/**
 * One line of the sheet a launch changes, drawn as "12/11 · Saída · Bradesco João: R$ 1.319,41 →
 * R$ 1.722,55". `cell` is the whole cell when it holds more than this line, so the day's total
 * shows too.
 */
export interface QueueLine {
  readonly label: string;
  /** A line that changes value, a new line, or the month's Economia (a signed change). */
  readonly change: "edit" | "new" | "economia";
  /** Null for a new line, and for the Economia tab, which Neko does not read: `after` is then the change, signed. */
  readonly before: Cents | null;
  readonly after: Cents;
  /** How much an edited line goes up or down; null for new lines and the Economia. */
  readonly diff: Cents | null;
  readonly cell: { readonly label: string; readonly before: Cents; readonly after: Cents } | null;
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
  /** Why the item is there, in one plain sentence, without amounts. */
  readonly note: string;
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
        ? `${dayMonth(only)} · Diário`
        : `Diário de ${draft.days.length} dias`,
    change: "edit",
    before: cents(before),
    after: cents(after),
    diff: cents(after - before),
    cell: null,
  };
};

/** Each line a draft changes, with its value now and after, in date order; Economia last. */
export const draftLines = (
  draft: Draft,
  ledger: Ledger,
  cards: readonly CardConfig[],
): QueueLine[] => {
  if (draft.type === "forecast") return [forecastLine(draft, ledger)];
  const placements = placeDraft(draft, cards).sort(
    (a, b) =>
      Number(a.target === "economia") - Number(b.target === "economia") ||
      a.date.localeCompare(b.date),
  );
  // What the whole cell holds before and after, when the line is not all of it.
  const cells = new Map<string, { before: Cents; delta: number }>();
  for (const p of placements) {
    if (p.target === "economia") continue;
    const key = `${p.date}|${p.column}`;
    const row = ledger.find((r) => r.date === p.date);
    const cell = cells.get(key) ?? { before: row?.[p.column].amount ?? (0 as Cents), delta: 0 };
    cell.delta += p.amount - (p.was ?? 0);
    // Real spending on a day with the Diário previsto takes the forecast off (see the writer).
    if (dropsForecast(p) && row) cell.delta -= forecastIn(row.diario);
    cells.set(key, cell);
  }
  const shown = new Set<string>();
  return placements.map((p): QueueLine => {
    if (p.target === "economia")
      return {
        label: `Economia de ${MONTHS[Number(p.date.slice(5, 7)) - 1]}`,
        change: "economia",
        before: null,
        after: cents(p.column === "entrada" ? -p.amount : p.amount),
        diff: null,
        cell: null,
      };
    const key = `${p.date}|${p.column}`;
    const cell = cells.get(key);
    const before = p.was ?? null;
    const own = before ?? 0;
    // The cell once per day and column, and only when something else is in it too.
    const whole =
      cell && !shown.has(key) && (cell.before !== own || cell.before + cell.delta !== p.amount)
        ? {
            label: `${COLUMN[p.column]} do dia`,
            before: cell.before,
            after: cents(cell.before + cell.delta),
          }
        : null;
    shown.add(key);
    return {
      label: `${dayMonth(p.date)} · ${COLUMN[p.column]} · ${p.description}`,
      change: before === null ? "new" : "edit",
      before,
      after: p.amount,
      diff: before === null ? null : cents(p.amount - before),
      cell: whole,
    };
  });
};

const titleOf = (item: QueueItem): string => {
  const draft = item.options[0]?.draft;
  if (!draft) return item.account ? `Conta ${item.account}` : "Conta nova sua";
  if (draft.type === "forecast")
    return draft.value > 0
      ? "Diário previsto"
      : draft.days.length === 1
        ? "Fechar o dia"
        : "Fechar os dias";
  if (draft.type === "card") return `Fatura ${draft.card}`;
  if (draft.type === "fix") return draft.line.description;
  return draft.description;
};

/**
 * Why the item is there, in one plain sentence; empty when the line itself says it. No amounts: the lines carry them, and hide them
 * with the rest of the screen when values are hidden.
 */
const noteOf = (item: QueueItem): string => {
  const draft = item.options[0]?.draft;
  switch (item.kind) {
    case "conta-propria":
      return `Dinheiro passou entre suas contas. A conta ${item.account ?? "nova"} guarda dinheiro ou é do dia a dia?`;
    case "previsto":
      if (draft?.type === "forecast" && draft.value > 0)
        return "Os dias que vêm recebem o Diário previsto.";
      return draft?.type === "forecast" && draft.days.length === 1
        ? "O dia passou: no Diário dele fica o que você gastou, não o previsto."
        : "Os dias passaram: no Diário deles fica o que você gastou, não o previsto.";
    case "cartao":
      if (draft?.type === "card" && draft.bills.every((b) => b.amount === b.was))
        return "O reembolso não bate com a fatura.";
      return draft?.type === "card" && draft.bills.some((b) => b.amount < b.was)
        ? "A fatura fechou com outro valor no banco."
        : "O banco já tem compras que a planilha não tem.";
    case "entrada":
      return draft?.type === "fix"
        ? "Entrou um valor diferente do previsto."
        : // The box under it says "Linha nova na planilha" and the line says Entrada: nothing to add.
          "";
    case "conta":
      return "Paga com outro valor ou em outro dia.";
    case "guardar":
      return "Você guardou dinheiro e a planilha não tem.";
    case "resgate":
      return "Você tirou da reserva e a planilha não tem.";
    default:
      // A purchase the sheet lacks: the box says "Linha nova na planilha", so no sentence repeats it.
      return "";
  }
};

/** A day that passed with nothing spent says so, instead of "fica o que você gastou". */
const closesToNothing = (item: QueueItem, ledger: Ledger): string | null => {
  const draft = item.options[0]?.draft;
  if (draft?.type !== "forecast" || draft.value !== 0) return null;
  if (forecastLine(draft, ledger).after !== 0) return null;
  return draft.days.length === 1
    ? "Você não gastou nada nesse dia: o Diário dele fica zerado."
    : "Você não gastou nada nesses dias: o Diário deles fica zerado.";
};

/** "03/10 · Diário · Padaria" under the title "Padaria" reads "03/10 · Diário". */
const untitled = (lines: QueueLine[], title: string): QueueLine[] =>
  lines.map((l) =>
    l.label.endsWith(` · ${title}`) ? { ...l, label: l.label.slice(0, -` · ${title}`.length) } : l,
  );

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
            lines: o.draft ? untitled(draftLines(o.draft, ledger, cards), titleOf(item)) : [],
          })),
          bank: item.bank,
          adjustable: item.options.some(
            (o) => o.draft !== null && o.draft.type !== "card" && o.draft.type !== "forecast",
          ),
          origin:
            item.bank.length === 1 && item.bank[0] ? originKey(item.bank[0].description) : null,
          note: closesToNothing(item, ledger) ?? noteOf(item),
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
