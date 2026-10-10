import type { Cents, Draft, EntryKind, LocalDate, MiaEntry } from "@neko/engine";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { type QueueItemView, type QueueLine, saldoView } from "../shared/queue.ts";
import type { BankView } from "../shared/types.ts";
import { ApiError, api, once, reasonOf } from "./api.ts";
import { bankText, money, readAtLabel, shortDate, toCents } from "./format.ts";
import { IconChevron } from "./icons.tsx";

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
  useEffect(() => {
    if (!t || undo.isPending) return;
    const timer = setTimeout(() => showToast(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [t, undo.isPending]);
  if (!t) return null;
  return (
    <div className="toast" role="status">
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
const Change = ({ line }: { line: QueueLine }) => (
  <li className="q-change">
    <span className="q-where">{bankText(line.label)}</span>
    <strong className="q-new">
      {line.change === "economia" ? signed(line.after) : money(line.after)}
    </strong>
    <span className="q-was">
      {line.change === "economia"
        ? "na aba Economia"
        : line.before === null
          ? "Linha nova"
          : `era ${money(line.before)}`}
    </span>
    {line.diff !== null && line.diff !== 0 && <span className="q-diff">{signed(line.diff)}</span>}
  </li>
);

/** What Lançar writes in the sheet; past the first three, behind a tap. */
const Impact = ({ lines }: { lines: readonly QueueLine[] }) => {
  const first = lines.slice(0, 3);
  const rest = lines.slice(3);
  return (
    <div className="q-impact">
      <p className="q-impact-head">Na planilha</p>
      <ul>
        {first.map((l) => (
          <Change key={`${l.label}|${l.before}|${l.after}`} line={l} />
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
              <Change key={`${l.label}|${l.before}|${l.after}`} line={l} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

/** The day's whole cell and what the bank showed: there for whoever wants to check, closed. */
const Details = ({ item, lines }: { item: QueueItemView; lines: readonly QueueLine[] }) => {
  const cells = lines.flatMap((l) => (l.cell ? [l.cell] : []));
  if (cells.length === 0 && item.bank.length === 0) return null;
  return (
    <details className="formula q-details">
      <summary>
        <IconChevron />
        Detalhes
      </summary>
      <ul className="q-bank">
        {cells.map((c) => (
          <li key={`${c.label}|${c.before}`}>
            <span>{c.label}</span>
            <span>
              {money(c.before)} → {money(c.after)}
            </span>
          </li>
        ))}
        {item.bank.map((m) => (
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
    </details>
  );
};

const HOW: readonly { kind: EntryKind; label: string }[] = [
  { kind: "diario", label: "Pix ou débito" },
  { kind: "entrada", label: "Entrada" },
  { kind: "conta", label: "Conta" },
];

const PARCELS = [1, 2, 3, 6, 10, 12];

type Editable = Extract<Draft, { type: "new" } | { type: "fix" }>;

const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/**
 * Valor, como pagou and Lançar. With a draft from Para lançar (Ajustar), only value, day and name
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
            Como pagou
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
        setSaid("A Mia não entendeu. Diga o valor e como pagou.");
        return;
      }
      onFill(lancamento);
      // The line names what is still missing, so Lançar off is never a puzzle.
      setSaid(
        lancamento.amount === undefined
          ? "A Mia preencheu. Diga o valor e lance."
          : !lancamento.kind
            ? "A Mia preencheu. Escolha como pagou e lance."
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
        aria-expanded={open}
        aria-keyshortcuts="L"
        title="Lançar (L)"
        onClick={() => setOpen(!open)}
      >
        Lançar
      </button>
      {open && <EntryForm cards={cards} today={today} onClose={() => setOpen(false)} />}
    </>
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
  const [choice, setChoice] = useState(0);
  const [adjusting, setAdjusting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const launch = useLaunch();
  const queryClient = useQueryClient();
  // Done: the item folds away before it leaves the list, so the next one slides up into place.
  const leave = () => {
    setLeaving(true);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => onGone(item.key), still ? 120 : 280);
  };
  const answer = useMutation({
    mutationFn: async (a: { ignore: true } | { use: "guardado" | "corrente" }) => {
      if ("ignore" in a) await api.ignore(item.key);
      else await api.accountUse(item.key.replace(/^conta:/, ""), a.use);
      return "ignore" in a;
    },
    onSuccess: (ignored) => {
      if (ignored)
        showToast({ entryId: null, text: "Ignorado. Não aparece mais.", ignored: item.key });
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
  return (
    <li
      className={`q-item${leaving ? " leaving" : ""}${busy ? " busy" : ""}`}
      data-key={item.key}
      aria-busy={busy}
    >
      <div className="q-body">
        <div className="q-head">
          <span className="name">{bankText(item.title)}</span>
          <span className="meta">{shortDate(item.date)}</span>
        </div>
        <p className="q-note">{item.note}</p>
        {item.options.length > 1 && !question && (
          <fieldset className="how" aria-label="O que lançar">
            {item.options.map((o, i) => (
              <button
                key={o.label}
                type="button"
                className="chip-button"
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
                      className="ghost small"
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
                  className="small"
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
                    className="ghost small"
                    disabled={!writing || busy}
                    title="Ajustar valor, dia ou nome"
                    onClick={() => setAdjusting(true)}
                  >
                    Ajustar
                  </button>
                )}
              </>
            )}
            {/* Ignorar is the way out, not a third choice: quiet, at the far end, with Desfazer */}
            <button
              type="button"
              className="text-link q-ignore"
              disabled={busy}
              onClick={() => answer.mutate({ ignore: true })}
            >
              Ignorar
            </button>
          </div>
        )}
        {error && (
          <p className="setting-error" role="alert">
            {message(error)}
          </p>
        )}
        <Details item={item} lines={lines} />
      </div>
    </li>
  );
};

/** With nothing left to launch, yesterday's Saldo against the bank, and the difference to launch. */
const Saldo = ({ bank, writing }: { bank: BankView; writing: boolean }) => {
  const s = saldoView(bank.saldo);
  const [fixing, setFixing] = useState(false);
  if (!s) return null;
  const stale =
    s.stale.length > 0 ? (
      <p className="hint">Sem atualizar hoje: {s.stale.join(", ")}. O saldo pode estar velho.</p>
    ) : null;
  if (s.diff === 0)
    return (
      <>
        <p className="q-ok">Tudo lançado. O saldo bate com o banco.</p>
        {stale}
      </>
    );
  return (
    <>
      <p className="q-lines">
        <span>
          Saldo de {shortDate(s.date)}: {money(s.sheet)} na planilha, {money(s.bank)} no banco.
        </span>
        <span>
          {s.diff > 0 ? "Faltam" : "Sobram"} {money(Math.abs(s.diff))} na planilha.
        </span>
      </p>
      {stale}
      {s.draft?.type === "new" &&
        (fixing ? (
          <EntryForm draft={s.draft} today={s.date} onClose={() => setFixing(false)} />
        ) : (
          writing && (
            <div className="q-actions">
              <button type="button" className="ghost small" onClick={() => setFixing(true)}>
                Lançar a diferença
              </button>
            </div>
          )
        ))}
    </>
  );
};

/** When the banks were last read, and Atualizar agora to read them without waiting for the morning. */
const Refresh = ({ syncedAt }: { syncedAt: string | null }) => {
  const queryClient = useQueryClient();
  const refresh = useMutation({
    mutationFn: api.refreshBanks,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["projection"] }),
  });
  return (
    <p className="q-sync">
      <span>
        {refresh.isPending
          ? "Lendo os bancos…"
          : refresh.data?.ok === false || refresh.isError
            ? "Algum banco não respondeu. Tente de novo mais tarde."
            : syncedAt
              ? `Bancos lidos ${readAtLabel(syncedAt)}.`
              : "Bancos ainda não lidos."}
      </span>
      <button
        type="button"
        className="text-link"
        disabled={refresh.isPending}
        onClick={() => refresh.mutate()}
      >
        Atualizar agora
      </button>
    </p>
  );
};

/** Items Para lançar shows before "Ver mais". */
const QUEUE_SHOWN = 3;

/** Para lançar on Hoje: what the bank showed and the sheet does not have yet, one item a line. */
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
  const [more, setMore] = useState(false);
  if (!queue) return null;
  const items = queue.filter((i) => !gone.has(i.key));
  if (items.length === 0 && !bank.saldo) return null;
  // The first few, so Hoje stays short; the chip counts them all and "Ver mais" opens the rest.
  const shown = more ? items : items.slice(0, QUEUE_SHOWN);
  return (
    <section className="panel" aria-labelledby="h-queue">
      <div className="panel-head">
        <h2 id="h-queue">Para lançar</h2>
        {items.length > 0 && (
          <span className="chip">{items.length === 1 ? "1 item" : `${items.length} itens`}</span>
        )}
      </div>
      <div className="q-intro">
        <p className="q-trust">Nada muda na planilha até você tocar em Lançar.</p>
        <Refresh syncedAt={bank.syncedAt} />
      </div>
      {items.length === 0 ? (
        <Saldo bank={bank} writing={writing} />
      ) : (
        <ul className="queue">
          {shown.map((i) => (
            <Row
              key={i.key}
              item={i}
              writing={writing}
              today={today}
              onGone={(k) => {
                // Focus moves to the next item's first answer, so a run of items goes tap by tap.
                const at = items.findIndex((x) => x.key === k);
                const next = items[at + 1] ?? items[at - 1];
                setHidden({ of: queue, keys: new Set(gone).add(k) });
                if (next)
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLButtonElement>(
                        `li[data-key="${CSS.escape(next.key)}"] .q-actions button:not(:disabled)`,
                      )
                      ?.focus(),
                  );
              }}
            />
          ))}
        </ul>
      )}
      {shown.length < items.length && (
        <button type="button" className="q-more" onClick={() => setMore(true)}>
          <IconChevron />
          Ver mais {items.length - shown.length}
        </button>
      )}
      {!writing && items.length > 0 && (
        <p className="hint">Para lançar daqui, ligue Lançar pelo Neko em Ajustes.</p>
      )}
    </section>
  );
};
