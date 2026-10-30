import type { Cents, Draft, EntryKind, LocalDate, MiaEntry } from "@neko/engine";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import {
  type PurchasesView,
  type QueueItemView,
  type QueueLine,
  saldoView,
} from "../shared/queue.ts";
import type { BankView, IgnoredItem } from "../shared/types.ts";
import { ApiError, api, once, reasonOf, used } from "./api.ts";
import { CategoryIcon } from "./CategoryIcon.tsx";
import {
  bankLineName,
  bankText,
  money,
  readAtLabel,
  shortDate,
  toCents,
  waitingText,
} from "./format.ts";
import {
  IconCard,
  IconCheck,
  IconChevron,
  IconChevronLeft,
  IconIncome,
  IconPlus,
  IconReceipt,
  IconRefresh,
  IconRepeat,
  IconToday,
} from "./icons.tsx";

/**
 * Para lançar and Lançar à mão (specs/005-lancamentos, Fase 2). The screen sends drafts the
 * Worker built; nothing here decides a cell. Every launch shows Desfazer for a few seconds.
 */

/** How long Desfazer stays on screen after a launch. */
const UNDO_MS = 10_000;

/** `ignored` brings back an item Ignorar took away; `entryId` undoes a launch. */
type Toast = {
  readonly entryId: string | null;
  readonly text: string;
  readonly ignored?: string;
} | null;
let toast: Toast = null;
const listeners = new Set<() => void>();
export const showToast = (t: Toast) => {
  toast = t;
  for (const f of listeners) f();
};
const useToast = () =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => toast,
  );

const message = reasonOf;

/** One request: the Worker writes only if each changed line still holds what Neko showed. */
const useLaunch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ draft, key }: { draft: Draft; key?: string }) => {
      const result = await once(`launch:${JSON.stringify(draft)}`, (id) =>
        api.launch({ id, draft, ...(key ? { key } : {}) }),
      );
      if (result.state !== "done")
        throw new ApiError(
          422,
          "write",
          result.error ?? "Não gravou. A planilha ficou como estava.",
        );
      return result;
    },
    onSuccess: (r) => {
      showToast({ entryId: r.entryId, text: "Lançado na planilha" });
      queryClient.invalidateQueries({ queryKey: ["projection"] });
    },
  });
};

/** Desfazer, at the bottom of Hoje, for a few seconds after each launch. */
export const LaunchToast = () => {
  const t = useToast();
  const queryClient = useQueryClient();
  const undo = useMutation({
    mutationFn: async (t: NonNullable<Toast>) => {
      if (t.ignored) {
        await api.unignore(t.ignored);
        return true;
      }
      const entryId = t.entryId;
      return entryId
        ? (await once(`undo:${entryId}`, () => api.undoEntry(entryId))).state === "undone"
        : false;
    },
    onSuccess: (undone) => {
      showToast({
        entryId: null,
        text: undone ? "Desfeito" : "A planilha mudou depois. Desfaça por lá",
      });
      queryClient.invalidateQueries({ queryKey: ["projection"] });
    },
    onError: (e) => showToast({ entryId: null, text: message(e) }),
  });
  // The clock stops while the pointer or the keyboard is on Desfazer, and starts over after.
  const [held, setHeld] = useState(false);
  // A toast that leaves under the pointer gets no mouseleave: the next one starts unheld.
  useEffect(() => {
    if (!t) setHeld(false);
  }, [t]);
  useEffect(() => {
    if (!t || undo.isPending || held) return;
    const timer = setTimeout(() => showToast(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [t, undo.isPending, held]);
  if (!t) return null;
  return (
    <div
      className="toast"
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span>{t.text}</span>
      {(t.entryId || t.ignored) && (
        <button
          type="button"
          className="ghost small"
          disabled={undo.isPending}
          onClick={() => undo.mutate(t)}
        >
          {undo.isPending ? "Desfazendo…" : "Desfazer"}
        </button>
      )}
    </div>
  );
};

const signed = (c: number) => `${c < 0 ? "−" : "+"}${money(Math.abs(c))}`;

/**
 * One change, read like a ledger line: where on the left, the new value on the right, and under
 * them what it was and by how much it moves.
 */
const Change = ({ line, allNew }: { line: QueueLine; allNew: boolean }) => {
  // When every line is new the box's head says so once; each line then needs no "Linha nova".
  const was =
    line.change === "economia"
      ? "na aba Economia"
      : line.before === null
        ? allNew
          ? null
          : "Linha nova"
        : `era ${money(line.before)}`;
  return (
    <li className="q-change">
      <span className="q-where">{bankText(line.label)}</span>
      <strong className="q-new">
        {line.change === "economia" ? signed(line.after) : money(line.after)}
      </strong>
      {was && <span className="q-was">{was}</span>}
      {line.diff !== null && line.diff !== 0 && <span className="q-diff">{signed(line.diff)}</span>}
    </li>
  );
};

/** Whether Lançar only adds lines (no line it changes, nothing in the Economia tab). */
const onlyNew = (lines: readonly QueueLine[]) =>
  lines.every((l) => l.before === null && l.change !== "economia");

/** What Lançar writes in the sheet; past the first three, behind a tap. */
const Impact = ({ lines }: { lines: readonly QueueLine[] }) => {
  const first = lines.slice(0, 3);
  const rest = lines.slice(3);
  const allNew = onlyNew(lines);
  return (
    <div className="q-impact">
      <p className="q-impact-head">
        {!allNew
          ? "Na planilha"
          : lines.length === 1
            ? "Linha nova na planilha"
            : `${lines.length} linhas novas na planilha`}
      </p>
      <ul>
        {first.map((l) => (
          <Change key={`${l.label}|${l.before}|${l.after}`} line={l} allNew={allNew} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="formula">
          <summary>
            <IconChevron />
            Mais {rest.length === 1 ? "1 mudança" : `${rest.length} mudanças`}
          </summary>
          <ul>
            {rest.map((l) => (
              <Change key={`${l.label}|${l.before}|${l.after}`} line={l} allNew={allNew} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

type Purchase = PurchasesView["lines"][number];

/** `15 out · 1/3`: when, and which parcel when it is one. */
const purchaseWhen = (l: Purchase) =>
  [
    l.date && shortDate(l.date),
    l.installment !== null && l.installments !== null && `${l.installment}/${l.installments}`,
  ]
    .filter(Boolean)
    .join(" · ");

const Purchase = ({ line }: { line: Purchase }) => (
  <li>
    <span className="text">
      {bankLineName(line)} <small>{purchaseWhen(line)}</small>
    </span>
    <span className={line.amount < 0 ? "amount pos" : "amount"}>{money(line.amount)}</span>
  </li>
);

/**
 * Why a bill goes up, as the bank lists it: the purchases that add up to the change, newest
 * first, like a bank app's bill. Past the first three, behind a tap.
 */
const Purchases = ({ groups }: { groups: readonly PurchasesView[] }) => {
  const head = (g: PurchasesView) =>
    !g.exact
      ? "Últimas no banco"
      : groups.length === 1
        ? `Compras novas · ${money(g.total)}`
        : `Compras novas · ${money(g.total)} na fatura de ${shortDate(g.due)}`;
  // The first three purchases in sight, the rest of each bill behind one tap.
  let left = 3;
  const split = groups.map((g) => {
    const shown = g.lines.slice(0, left);
    left -= shown.length;
    return { g, shown, hidden: g.lines.slice(shown.length) };
  });
  const hidden = split.reduce((n, s) => n + s.hidden.length, 0);
  const block = (g: PurchasesView, rows: readonly Purchase[], titled: boolean) =>
    rows.length > 0 && (
      <Fragment key={g.due}>
        {titled && <p className="q-buys-head">{head(g)}</p>}
        <ul>
          {rows.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the bank can list two equal purchases.
            <Purchase key={`${l.description}|${l.date}|${i}`} line={l} />
          ))}
        </ul>
      </Fragment>
    );
  return (
    <div className="q-buys bank-lines">
      {split.map(({ g, shown }) => block(g, shown, true))}
      {hidden > 0 && (
        <details className="formula">
          <summary>
            <IconChevron />
            Mais {hidden === 1 ? "1 compra" : `${hidden} compras`}
          </summary>
          {split.map(({ g, shown, hidden: rows }) => block(g, rows, shown.length === 0))}
        </details>
      )}
    </div>
  );
};

/** The day's whole cell and what the bank showed, for whoever wants to check; none, nothing to open. */
const detailsOf = (item: QueueItemView, lines: readonly QueueLine[]) => ({
  cells: lines.flatMap((l) => (l.cell ? [l.cell] : [])),
  bank: item.bank,
});

const Details = ({ id, of }: { id: string; of: ReturnType<typeof detailsOf> }) => (
  <ul className="q-bank" id={id}>
    {of.cells.map((c) => (
      <li key={`${c.label}|${c.before}`}>
        <span>{c.label}</span>
        <span>
          {money(c.before)} → {money(c.after)}
        </span>
      </li>
    ))}
    {of.bank.map((m) => (
      <li key={`${m.date}|${m.amount}|${m.description}`}>
        <span>
          {shortDate(m.date)} · {bankText(m.description)}
        </span>
        <span className={m.amount > 0 ? "pos" : undefined}>
          {m.amount > 0 ? "+" : "−"}
          {money(Math.abs(m.amount))}
        </span>
      </li>
    ))}
  </ul>
);

const HOW: readonly { kind: EntryKind; label: string }[] = [
  { kind: "diario", label: "Pix ou débito" },
  { kind: "entrada", label: "Entrada" },
  { kind: "conta", label: "Conta" },
];

const PARCELS = [1, 2, 3, 6, 10, 12];

type Editable = Extract<Draft, { type: "new" } | { type: "fix" }>;

const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/**
 * Valor, tipo and Lançar. With a draft from Para lançar (Ajustar), only value, day and name
 * change; by hand, the owner also says how it was paid, and the parcels on a card.
 */
export const EntryForm = ({
  draft,
  cards = [],
  today,
  launchKey,
  onClose,
  onDone = onClose,
}: {
  draft?: Editable;
  cards?: readonly string[];
  today: LocalDate;
  launchKey?: string;
  onClose: () => void;
  onDone?: () => void;
}) => {
  const id = useId();
  const [typed, setTyped] = useState(draft ? reais(draft.amount) : "");
  const [how, setHow] = useState<string>(
    draft?.type === "new" ? (draft.card ? `card:${draft.card}` : draft.kind) : "diario",
  );
  const [count, setCount] = useState(1);
  const [date, setDate] = useState<string>(draft?.date ?? today);
  const [name, setName] = useState(draft?.description ?? "");
  const launch = useLaunch();
  const amount = toCents(typed);
  const card = how.startsWith("card:") ? how.slice(5) : null;
  const parcels = PARCELS.includes(count) ? PARCELS : [...PARCELS, count].sort((a, b) => a - b);
  const mia = useQuery({ queryKey: ["mia"], queryFn: api.mia, staleTime: 60_000 });
  // Lançar com a Mia, by hand only, while she is on and not resting for the month.
  const say = !draft && mia.data?.ligada === true && !mia.data.pausadaAte;
  const ok =
    amount !== null &&
    amount > 0 &&
    name.trim() !== "" &&
    // A sentence that left the way of paying open asks the owner to pick one.
    (draft !== undefined || how !== "") &&
    /^\d{4}-\d{2}-\d{2}$/.test(date);
  // What still keeps Lançar off, said beside it; and a day outside this month, said before it goes.
  const missing =
    amount === null || amount <= 0
      ? typed.trim() === ""
        ? "Falta o valor"
        : "Escreva o valor como 42,50"
      : name.trim() === ""
        ? "Falta o nome"
        : draft === undefined && how === ""
          ? "Escolha o tipo"
          : !/^\d{4}-\d{2}-\d{2}$/.test(date)
            ? "Falta o dia"
            : null;
  const away =
    missing !== null
      ? null
      : date > today
        ? `Vai para ${shortDate(date)}, um dia que ainda não chegou`
        : date.slice(0, 7) !== today.slice(0, 7)
          ? `Vai para ${shortDate(date)}, fora deste mês`
          : null;

  const build = (): Draft | null => {
    if (!ok || amount === null) return null;
    const common = { amount: amount as Cents, date: date as LocalDate, description: name.trim() };
    if (draft?.type === "fix") return { ...draft, ...common };
    if (card) return { type: "new", kind: "cartao", card, installments: count, ...common };
    return { type: "new", kind: (draft?.kind ?? how) as EntryKind, ...common };
  };

  return (
    <form
      className="panel sim entry"
      aria-label={draft ? "Ajustar antes de lançar" : "Lançar à mão"}
      onSubmit={(e) => {
        e.preventDefault();
        const d = build();
        if (d)
          launch.mutate(
            { draft: d, ...(launchKey ? { key: launchKey } : {}) },
            { onSuccess: onDone },
          );
      }}
    >
      {say && (
        <SaySentence
          cards={cards}
          // A new sentence replaces every field, so nothing from the last one stays behind.
          onFill={(e) => {
            setTyped(e.amount !== undefined ? reais(e.amount) : "");
            setHow(e.kind === "cartao" && e.card ? `card:${e.card}` : (e.kind ?? ""));
            setCount(e.kind === "cartao" ? (e.installments ?? 1) : 1);
            setDate(e.date ?? today);
            setName(e.description ?? "");
          }}
        />
      )}
      <label className="field" htmlFor={`${id}-v`}>
        Valor
      </label>
      <span className="affix big">
        <span aria-hidden="true">R$</span>
        <input
          id={`${id}-v`}
          inputMode="decimal"
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the value is what this form opens for, unless Mia is on
          autoFocus={!say}
          placeholder="0,00"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </span>
      {!draft && (
        <>
          <span className="field" id={`${id}-how`}>
            Tipo
          </span>
          <fieldset className="how" aria-labelledby={`${id}-how`}>
            {[...HOW, ...cards.map((c) => ({ kind: `card:${c}`, label: c }))].map((o) => (
              <button
                key={o.kind}
                type="button"
                className="chip-button"
                aria-pressed={how === o.kind}
                onClick={() => setHow(o.kind)}
              >
                {o.label}
              </button>
            ))}
          </fieldset>
          {card && (
            <fieldset className="parcels" aria-label="Parcelas">
              {parcels.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="chip-button"
                  aria-pressed={count === n}
                  onClick={() => setCount(n)}
                >
                  {n === 1 ? "À vista" : `${n}×`}
                </button>
              ))}
            </fieldset>
          )}
        </>
      )}
      <div className="entry-row">
        <label className="field">
          Nome
          <input
            value={name}
            maxLength={80}
            placeholder="Padaria"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          Dia
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {launch.isError && (
        <p className="setting-error" role="alert">
          {message(launch.error)}
        </p>
      )}
      <p className="hint" aria-live="polite">
        {missing ?? away}
      </p>
      <div className="actions">
        <button type="submit" disabled={!ok || launch.isPending}>
          {launch.isPending ? "Lançando…" : "Lançar"}
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </form>
  );
};

/**
 * Lançar com a Mia (Fase 4): one sentence fills the fields below; the owner checks them and taps
 * Lançar as always. Shown only while Mia is on and not resting for the month.
 */
const SaySentence = ({
  cards,
  onFill,
}: {
  cards: readonly string[];
  onFill: (e: MiaEntry) => void;
}) => {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [frase, setFrase] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const fill = useMutation({
    mutationFn: () => api.miaEntry(frase.trim(), cards),
    onSuccess: ({ lancamento }) => {
      if (!lancamento) {
        setSaid("A Mia não entendeu. Diga o valor e o tipo.");
        return;
      }
      onFill(lancamento);
      // The line names what is still missing, so Lançar off is never a puzzle.
      setSaid(
        lancamento.amount === undefined
          ? "A Mia preencheu. Diga o valor e lance."
          : !lancamento.kind
            ? "A Mia preencheu. Escolha o tipo e lance."
            : !lancamento.description
              ? "A Mia preencheu. Dê um nome e lance."
              : "A Mia preencheu. Confira e lance.",
      );
      // The phone keyboard closes, so the filled fields and Lançar show.
      input.current?.blur();
    },
    onError: (e) =>
      setSaid(
        e instanceof ApiError && e.status === 429
          ? "A Mia descansa até o mês que vem. Preencha abaixo."
          : "A Mia não respondeu. Preencha abaixo.",
      ),
  });
  const send = () => {
    if (frase.trim() && !fill.isPending) {
      setSaid(null);
      fill.mutate();
    }
  };
  return (
    <div className="say">
      <label className="field" htmlFor={`${id}-f`}>
        Numa frase
      </label>
      <span className="say-row">
        <input
          ref={input}
          id={`${id}-f`}
          // biome-ignore lint/a11y/noAutofocus: with Mia on, the sentence is what the form opens for
          autoFocus
          autoComplete="off"
          maxLength={300}
          placeholder="Padaria 12,50 no Pix"
          value={frase}
          onChange={(e) => setFrase(e.target.value)}
          onKeyDown={(e) => {
            // Enter here fills the form; it must not launch it.
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className="ghost small"
          aria-disabled={!frase.trim() || fill.isPending}
          onClick={send}
        >
          {fill.isPending ? "Preenchendo…" : "Preencher"}
        </button>
      </span>
      <p className="hint" aria-live="polite">
        {said}
      </p>
    </div>
  );
};

/** Lançar à mão: a button on Hoje that opens the form in place, like Simular compra. */
export const ManualLaunch = ({ cards, today }: { cards: readonly string[]; today: LocalDate }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="add"
        aria-expanded={open}
        aria-keyshortcuts="L"
        title="Lançar (L)"
        onClick={() => {
          if (!open) used("lancar");
          setOpen(!open);
        }}
      >
        <IconPlus />
        Lançar
      </button>
      {open && <EntryForm cards={cards} today={today} onClose={() => setOpen(false)} />}
    </>
  );
};

/** The item's mark: what it is about when the name says it, else what kind of line it makes. */
const KIND_ICON: Partial<Record<QueueItemView["kind"], () => React.JSX.Element>> = {
  cartao: IconCard,
  entrada: IconIncome,
  resgate: IconIncome,
  previsto: IconToday,
  "conta-propria": IconRepeat,
  guardar: IconRepeat,
};
const Mark = ({ item }: { item: QueueItemView }) => {
  const Kind = KIND_ICON[item.kind] ?? IconReceipt;
  return (
    <span className="avatar" aria-hidden="true">
      {item.kind === "cartao" || item.kind === "previsto" ? (
        <Kind />
      ) : (
        <CategoryIcon text={item.title} fallback={<Kind />} />
      )}
    </span>
  );
};

const Row = ({
  item,
  writing,
  today,
  onGone,
}: {
  item: QueueItemView;
  writing: boolean;
  today: LocalDate;
  onGone: (key: string) => void;
}) => {
  const id = useId();
  const [choice, setChoice] = useState(0);
  const [adjusting, setAdjusting] = useState(false);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const launch = useLaunch();
  const queryClient = useQueryClient();
  // Done: the item slides off the deck before the next one takes its place.
  const leave = () => {
    setLeaving(true);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => onGone(item.key), still ? 120 : 220);
  };
  const answer = useMutation({
    mutationFn: async (a: { ignore: true } | { use: "guardado" | "corrente" }) => {
      if ("ignore" in a) await api.ignore(item.key);
      else await api.accountUse(item.key.replace(/^conta:/, ""), a.use);
      return "ignore" in a;
    },
    onSuccess: (ignored) => {
      if (ignored) showToast({ entryId: null, text: "Ignorado", ignored: item.key });
      leave();
      queryClient.invalidateQueries({ queryKey: ["projection"] });
    },
  });
  const option = item.options[choice] ?? item.options[0];
  const draft = option?.draft ?? null;
  const question = item.options.every((o) => o.draft === null);
  const busy = launch.isPending || answer.isPending || leaving;
  const error = launch.error ?? answer.error;
  const lines = option?.lines ?? [];
  const details = detailsOf(item, lines);
  const hasDetails = details.cells.length > 0 || details.bank.length > 0;
  return (
    <li
      className={`q-item${leaving ? " leaving" : ""}${busy ? " busy" : ""}`}
      data-key={item.key}
      aria-busy={busy}
    >
      <div className="q-head">
        <Mark item={item} />
        <span className="name">{bankText(item.title)}</span>
        <span className="meta">{shortDate(item.date)}</span>
      </div>
      {item.note && <p className="q-note">{item.note}</p>}
      {item.purchases.length > 0 && <Purchases groups={item.purchases} />}
      {item.options.length > 1 && !question && (
        <fieldset className="q-choice">
          <legend className="sr-only">O que lançar</legend>
          {item.options.map((o, i) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={choice === i}
              disabled={busy}
              onClick={() => setChoice(i)}
            >
              {o.label}
            </button>
          ))}
        </fieldset>
      )}
      {lines.length > 0 && <Impact lines={lines} />}
      {adjusting && draft && draft.type !== "card" && draft.type !== "forecast" ? (
        <EntryForm
          draft={draft}
          today={today}
          launchKey={item.key}
          onClose={() => setAdjusting(false)}
          onDone={leave}
        />
      ) : (
        <div className="q-actions">
          {question ? (
            item.options.map(
              (o) =>
                o.answer && (
                  <button
                    key={o.label}
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => o.answer && answer.mutate({ use: o.answer })}
                  >
                    {o.label}
                  </button>
                ),
            )
          ) : (
            <>
              <button
                type="button"
                className="q-go"
                disabled={!writing || !draft || (busy && !launch.isPending)}
                aria-disabled={launch.isPending || undefined}
                aria-busy={launch.isPending || undefined}
                onClick={() =>
                  !busy && draft && launch.mutate({ draft, key: item.key }, { onSuccess: leave })
                }
              >
                {launch.isPending && <span className="q-spinner" aria-hidden="true" />}
                {launch.isPending ? "Lançando…" : "Lançar"}
              </button>
              {item.adjustable && draft?.type !== "card" && (
                <button
                  type="button"
                  className="ghost"
                  disabled={!writing || busy}
                  title="Ajustar valor, dia ou nome"
                  onClick={() => setAdjusting(true)}
                >
                  Ajustar
                </button>
              )}
            </>
          )}
        </div>
      )}
      {error && (
        <p className="setting-error" role="alert">
          {message(error)}
        </p>
      )}
      {/* Detalhes to check, Ignorar to leave: both quiet, under the answer */}
      <div className="q-foot">
        {hasDetails && (
          <button
            type="button"
            className="q-toggle"
            aria-expanded={open}
            aria-controls={`${id}-d`}
            onClick={() => setOpen(!open)}
          >
            <IconChevron />
            Detalhes
          </button>
        )}
        <button
          type="button"
          className="text-link q-ignore"
          disabled={busy}
          onClick={() => answer.mutate({ ignore: true })}
        >
          Ignorar
        </button>
      </div>
      {hasDetails && open && <Details id={`${id}-d`} of={details} />}
    </li>
  );
};

/** With nothing left to launch: yesterday's Saldo, the sheet's beside the bank's, and the gap. */
const Saldo = ({ bank, writing }: { bank: BankView; writing: boolean }) => {
  const s = saldoView(bank.saldo);
  const [fixing, setFixing] = useState(false);
  if (!s) return null;
  const even = s.diff === 0;
  // Only the bank being late with planned lines: nothing to launch, so nothing to fix either.
  const waiting = s.waiting.length > 0;
  return (
    <div className="q-saldo">
      <p className={`q-verdict${even || waiting ? " even" : ""}`}>
        {even || waiting ? (
          <>
            <IconCheck />
            Tudo lançado
          </>
        ) : (
          `${s.diff > 0 ? "Faltam" : "Sobram"} ${money(Math.abs(s.diff))} na planilha`
        )}
      </p>
      <dl className="q-compare">
        <div>
          <dt>Planilha</dt>
          <dd>{money(s.sheet)}</dd>
        </div>
        <div>
          <dt>Banco</dt>
          <dd>{money(s.bank)}</dd>
        </div>
      </dl>
      <p className="q-saldo-when">
        Conferido até o fim de {shortDate(s.date)}
        {even ? ": bate com o banco." : "."}
      </p>
      {waiting && <p className="hint">{waitingText(s.waiting)}</p>}
      {s.stale.length > 0 && (
        <p className="hint">Sem atualizar hoje: {s.stale.join(", ")}. O saldo pode estar velho.</p>
      )}
      {s.draft?.type === "new" &&
        (fixing ? (
          <EntryForm draft={s.draft} today={s.date} onClose={() => setFixing(false)} />
        ) : (
          writing && (
            <div className="q-actions">
              <button type="button" className="ghost" onClick={() => setFixing(true)}>
                Lançar a diferença
              </button>
            </div>
          )
        ))}
    </div>
  );
};

/** When the banks were last read, and Atualizar to read them without waiting for the morning. */
const Refresh = ({ syncedAt }: { syncedAt: string | null }) => {
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: api.refreshBanks,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["projection"] }),
  });
  return (
    <p className="q-sync">
      <span aria-live="polite">
        {refresh.isPending
          ? "Lendo os bancos…"
          : refresh.data?.ok === false || refresh.isError
            ? "Algum banco não respondeu. Tente mais tarde."
            : syncedAt
              ? `Bancos lidos ${readAtLabel(syncedAt)}`
              : "Bancos ainda não lidos"}
      </span>
      <button
        type="button"
        className="text-link"
        disabled={refresh.isPending}
        onClick={() => refresh.mutate()}
      >
        <IconRefresh />
        Atualizar
      </button>
    </p>
  );
};

/**
 * Para lançar on Hoje: a deck, one item at a time. The bar under the title fills as items are
 * answered, and the edges under the card say more are waiting.
 */
export const ParaLancar = ({
  bank,
  writing,
  today,
}: {
  bank: BankView;
  writing: boolean;
  today: LocalDate;
}) => {
  const queue = bank.queue;
  // Hidden until the next read of the queue, which leaves out what was launched and brings back
  // what was undone.
  const [hidden, setHidden] = useState<{ of: unknown; keys: ReadonlySet<string> }>({
    of: queue,
    keys: new Set(),
  });
  const gone = hidden.of === queue ? hidden.keys : new Set<string>();
  const [at, setAt] = useState(0);
  const [back, setBack] = useState(false);
  const deck = useRef<HTMLElement>(null);
  if (!queue) return null;
  const items = queue.filter((i) => !gone.has(i.key));
  if (items.length === 0 && !bank.saldo) return null;
  const index = Math.min(at, Math.max(items.length - 1, 0));
  const item = items[index];
  const total = items.length + gone.size;
  const go = (to: number) => {
    setBack(to < index);
    setAt(to);
  };
  return (
    <section
      ref={deck}
      className="panel q-deck"
      aria-labelledby="h-queue"
      data-under={Math.min(Math.max(items.length - 1 - index, 0), 2)}
      // ← and → go through the items while the focus is on the card, but not inside a field.
      onKeyDown={(e) => {
        if (e.defaultPrevented || e.target instanceof HTMLInputElement) return;
        const to = e.key === "ArrowLeft" ? index - 1 : e.key === "ArrowRight" ? index + 1 : -1;
        if (to < 0 || to >= items.length) return;
        e.preventDefault();
        go(to);
      }}
    >
      <div className="panel-head">
        <h2 id="h-queue">Para lançar</h2>
        {total > 1 && items.length > 0 && (
          <span className="q-nav">
            <button
              type="button"
              className="icon"
              aria-label="Anterior"
              aria-keyshortcuts="ArrowLeft"
              title="Anterior (←)"
              disabled={index === 0}
              onClick={() => go(index - 1)}
            >
              <IconChevronLeft />
            </button>
            <span className="q-count" aria-live="polite">
              {gone.size + index + 1} de {total}
            </span>
            <button
              type="button"
              className="icon"
              aria-label="Próximo"
              aria-keyshortcuts="ArrowRight"
              title="Próximo (→)"
              disabled={index >= items.length - 1}
              onClick={() => go(index + 1)}
            >
              <IconChevron />
            </button>
          </span>
        )}
      </div>
      {total > 1 && (
        <div className="q-progress" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => i).map((i) => (
            <span
              key={i}
              className={
                i < gone.size ? "done" : i === gone.size + index && item ? "here" : undefined
              }
            />
          ))}
        </div>
      )}
      {item ? (
        <ul className={`queue${back ? " back" : ""}`}>
          <Row
            key={item.key}
            item={item}
            writing={writing}
            today={today}
            onGone={(k) => {
              setBack(false);
              setHidden({ of: queue, keys: new Set(gone).add(k) });
              // The next item's Lançar takes the focus, so a run of items goes tap by tap.
              requestAnimationFrame(() =>
                deck.current
                  ?.querySelector<HTMLButtonElement>(".q-actions button:not(:disabled)")
                  ?.focus(),
              );
            }}
          />
        </ul>
      ) : (
        <Saldo bank={bank} writing={writing} />
      )}
      {!writing && items.length > 0 && (
        <p className="hint">Para lançar daqui, ligue Lançar pelo Neko em Ajustes.</p>
      )}
      <div className="q-tail">
        <Refresh syncedAt={bank.syncedAt} />
        <Ignored items={bank.ignored ?? []} />
      </div>
    </section>
  );
};

/** What Ignorar set aside, behind a tap: any of it comes back after Desfazer is gone. */
const Ignored = ({ items }: { items: readonly IgnoredItem[] }) => {
  const queryClient = useQueryClient();
  const back = useMutation({
    mutationFn: api.unignore,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projection"] }),
  });
  if (items.length === 0) return null;
  return (
    <details className="formula q-ignored">
      <summary>
        <IconChevron />
        {items.length === 1 ? "1 ignorado" : `${items.length} ignorados`}
      </summary>
      <ul className="q-bank">
        {items.map((i) => (
          <li key={i.key}>
            <span>
              {shortDate(i.date)} · {bankText(i.title)}
            </span>
            <button
              type="button"
              className="text-link"
              disabled={back.isPending}
              aria-label={`Trazer de volta ${bankText(i.title)}`}
              onClick={() => back.mutate(i.key)}
            >
              Trazer de volta
            </button>
          </li>
        ))}
      </ul>
      {back.isError && <p className="hint error">{message(back.error)}</p>}
    </details>
  );
};
