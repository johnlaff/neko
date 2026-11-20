import { useIsFetching, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type PointerEvent, useEffect, useId, useRef, useState } from "react";
import type { SubscriptionsView } from "../../shared/types.ts";
import { api } from "../api.ts";
import { CategoryIcon } from "../CategoryIcon.tsx";
import { BigMoney } from "../Figures.tsx";
import { bankText, merchantName, money, shortDate } from "../format.ts";
import { IconCheck, IconChevron, IconRepeat } from "../icons.tsx";
import { Sheet } from "../Sheet.tsx";
import { OwnerForm } from "./Owner.tsx";
import { plural } from "./text.ts";

type Row = SubscriptionsView["items"][number];

const nameOf = (r: Pick<Row, "description">) => bankText(merchantName(r.description));
const dayOf = (r: Row) => Number(r.last.slice(8, 10));
/** What asks for a look first: charged after the mark, went up, or new. */
const flagged = (r: Row) => r.again !== null || r.before !== null || r.isNew;

const Tile = ({ text }: { text: string }) => (
  <span className="avatar" aria-hidden="true">
    <CategoryIcon text={text} fallback={<IconRepeat />} />
  </span>
);

/** The one or two words a row needs besides its name; the sheet has the rest. */
const Chips = ({ r }: { r: Row }) => (
  <>
    {r.again ? (
      <span className="chip bad">Cobrou de novo</span>
    ) : r.before !== null ? (
      <span className="chip warn">Subiu</span>
    ) : r.isNew ? (
      <span className="chip ok">Nova</span>
    ) : null}
    {r.cancel && !r.again && <span className="chip plain">A cancelar</span>}
    {r.split && <span className="chip plain">Dividida</span>}
  </>
);

const useMark = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      key,
      ...marks
    }: {
      key: string;
      mark?: "cancel" | "keep" | null;
      hidden?: boolean;
    }) => api.markSubscription(key, marks),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["projection"] }),
  });
};

/** Everything about one subscription, and the decisions about it: keep, cancel, split, hide. */
const SubscriptionDetail = ({
  r,
  people,
  waits,
  onHide,
}: {
  r: Row;
  people: readonly string[];
  waits: readonly string[];
  onHide: () => void;
}) => {
  const id = useId();
  const mark = useMark();
  const [owner, setOwner] = useState(false);
  const saving = mark.isPending && mark.variables.mark !== undefined;
  const choice = saving ? mark.variables.mark : r.cancel ? "cancel" : r.kept ? "keep" : null;
  const top = Math.max(1, ...r.charged.map((c) => c.amount));
  return (
    <div className="sub-detail">
      <div className="sheet-item">
        <Tile text={r.description} />
        <span className="name">{nameOf(r)}</span>
        <span className="meta">
          {r.card} · cobra no dia {dayOf(r)}
        </span>
      </div>
      <div className="sub-figure">
        <BigMoney cents={r.amount} tone="plain" />
        <span className="muted">por mês</span>
        <Chips r={r} />
      </div>
      <p className="hint">
        {money(r.amount * 12)} em um ano
        {r.before !== null && ` · antes era ${money(r.before)}`}
        {r.again && ` · cobrou em ${shortDate(r.again)}, depois de marcada para cancelar`}
      </p>
      {r.charged.length > 0 && (
        <ul className="sub-charges" aria-label="Últimas cobranças">
          {r.charged.map((c) => (
            <li key={c.date}>
              <span className="meta">{shortDate(c.date)}</span>
              <i style={{ width: `${Math.round((c.amount / top) * 100)}%` }} aria-hidden="true" />
              <span>{money(c.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="chip-radios sub-choice">
        <legend className="sr-only">O que fazer com {nameOf(r)}</legend>
        {(
          [
            ["cancel", "Vou cancelar"],
            ["keep", "Manter"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="chip-radio">
            <input
              type="radio"
              name={`${id}-mark`}
              checked={choice === k}
              // Not disabled while saving: that would drop the keyboard's focus to the page.
              aria-disabled={saving || undefined}
              onChange={() => {
                if (!saving) mark.mutate({ key: r.key, mark: k });
              }}
            />
            {choice === k && <IconCheck />}
            {label}
          </label>
        ))}
      </fieldset>
      {choice === "cancel" && (
        <p className="hint">
          Cancele no app ou no site dela. Quando a cobrança parar, ela vai para "Você já cortou".
        </p>
      )}
      {r.splitKey &&
        (owner ? (
          <div className="sub-owner">
            <h3>De quem é, todo mês</h3>
            <OwnerForm
              markKey={r.splitKey}
              amount={r.amount}
              current={r.split ? { person: r.split.person, share: r.split.share } : null}
              installments={null}
              due={null}
              monthly
              people={people}
              waits={waits}
              onDone={() => setOwner(false)}
            />
          </div>
        ) : (
          <button type="button" className="setting sub-split" onClick={() => setOwner(true)}>
            <span className="label">
              {r.split ? `Dividida com ${r.split.person}` : "Dividir com alguém"}
              <span className="sub">
                {r.split
                  ? r.split.share < r.amount
                    ? `${r.split.person} paga ${money(r.split.share)} todo mês`
                    : `${r.split.person} paga tudo todo mês`
                  : "Metade todo mês, ou outro valor"}
              </span>
            </span>
            <IconChevron />
          </button>
        ))}
      {mark.isError && (
        <p className="warn" role="alert">
          Não salvou.{" "}
          <button type="button" className="text-link" onClick={() => mark.mutate(mark.variables)}>
            Tentar de novo
          </button>
        </p>
      )}
      <button
        type="button"
        className="text-link quiet"
        disabled={mark.isPending}
        onClick={() => mark.mutate({ key: r.key, hidden: true }, { onSuccess: onHide })}
      >
        Não é assinatura
      </button>
    </div>
  );
};

const SHOWN = 4;

/**
 * Charges of the same value that came back each month on the owner's cards, in half a screen: four
 * rows, what asks for a look on top (charged after the mark, went up, new), then the biggest, the
 * rest one tap away; a charge after the mark is also said in words under the list. A tap opens the subscription; deciding lives there and in "Revisar uma a uma".
 */
export const Subscriptions = ({
  subs,
  month,
  people,
  waits,
}: {
  subs: SubscriptionsView;
  month: string;
  people: readonly string[];
  waits: readonly string[];
}) => {
  const mark = useMark();
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [gone, setGone] = useState<Row | null>(null);
  const undo = useRef<HTMLButtonElement>(null);
  // The row it came from is gone: the focus waits on Desfazer instead of falling to the page.
  useEffect(() => {
    if (gone) undo.current?.focus();
  }, [gone]);
  const order = [...subs.items.filter(flagged), ...subs.items.filter((r) => !flagged(r))];
  const shown = all ? order : order.slice(0, SHOWN);
  const again = subs.items.filter((r) => r.again !== null);
  const picked = subs.items.find((r) => r.key === open) ?? null;
  const cut = subs.cut.items.map(nameOf);
  return (
    <section className="panel subs-panel">
      <div className="panel-head">
        <h2>Assinaturas</h2>
        <span className="meta">{money(subs.total)} por mês</span>
      </div>
      <ul className="rows lead subs">
        {shown.map((r) => (
          <li key={r.key} className="bill">
            <button
              type="button"
              className="row-link"
              aria-haspopup="dialog"
              onClick={() => setOpen(r.key)}
            >
              <Tile text={r.description} />
              <span className="name">
                {nameOf(r)}
                <Chips r={r} />
              </span>
              <span className="value">
                {money(r.amount)}
                <IconChevron />
              </span>
              <span className="meta">
                {r.card} · dia {dayOf(r)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {order.length > SHOWN && (
        <button
          type="button"
          className="text-link"
          aria-expanded={all}
          onClick={() => setAll((x) => !x)}
        >
          {all
            ? "Ver menos"
            : order.length - SHOWN === 1
              ? "Ver mais uma"
              : `Ver mais ${order.length - SHOWN}`}
        </button>
      )}
      <div aria-live="polite" className="subs-status">
        {gone && (
          <p className="hint">
            {nameOf(gone)} saiu da lista.{" "}
            <button
              ref={undo}
              type="button"
              className="text-link"
              disabled={mark.isPending}
              onClick={() =>
                mark.mutate({ key: gone.key, hidden: false }, { onSuccess: () => setGone(null) })
              }
            >
              Desfazer
            </button>
          </p>
        )}
        {mark.isError && (
          <p className="warn" role="alert">
            Não voltou para a lista. Tente de novo.
          </p>
        )}
      </div>
      {(again.length > 0 || subs.toCancel > 0 || subs.cut.total > 0) && (
        <div className="subs-foot">
          {again.map((r) => (
            <p key={r.key} className="neg">
              {nameOf(r)} cobrou de novo em {shortDate(r.again ?? "")}, depois de marcada para
              cancelar.
            </p>
          ))}
          {subs.toCancel > 0 && (
            <p className="due">
              {plural(subs.items.filter((r) => r.cancel).length, "a cancelar", "a cancelar")}:{" "}
              {money(subs.toCancel)} a menos por mês
            </p>
          )}
          {subs.cut.total > 0 && (
            <p className="hint">
              <IconCheck /> Você já cortou {money(subs.cut.total)} por mês ({cut.join(", ")})
            </p>
          )}
        </div>
      )}
      <Link className="button ghost" to="/faturas" search={{ m: month, revisar: true }}>
        Revisar uma a uma
        {subs.undecided > 0 && subs.undecided < subs.items.length && (
          <span className="faint">{subs.undecided} sem decisão</span>
        )}
      </Link>
      {subs.hidden.length > 0 && (
        <details className="formula subs-hidden">
          <summary>
            Não são assinaturas ({subs.hidden.length})
            <IconChevron />
          </summary>
          <ul className="rows">
            {subs.hidden.map((r) => (
              <li key={r.key}>
                <span className="name">{nameOf(r)}</span>
                <button
                  type="button"
                  className="ghost small"
                  disabled={mark.isPending}
                  onClick={() => mark.mutate({ key: r.key, hidden: false })}
                >
                  Voltar para a lista
                </button>
                <span className="meta">
                  {r.card} · {money(r.amount)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Sheet open={picked !== null} title="Assinatura" onClose={() => setOpen(null)}>
        {picked && (
          <SubscriptionDetail
            r={picked}
            people={people}
            waits={waits}
            onHide={() => {
              setGone(picked);
              setOpen(null);
            }}
          />
        )}
      </Sheet>
    </section>
  );
};

/** The end of a review: what was marked to cancel, and what it takes off each month. */
const ReviewDone = ({
  subs,
  rows,
  decided,
  failed,
  onRetry,
  onBack,
  onAgain,
}: {
  subs: SubscriptionsView;
  rows: readonly Row[];
  decided: Record<string, "keep" | "cancel">;
  failed: Record<string, "keep" | "cancel">;
  onRetry: () => void;
  onBack: () => void;
  onAgain: () => void;
}) => {
  const title = useRef<HTMLHeadingElement>(null);
  // The total comes from the projection read again with the marks, not from adding them here.
  const reading = useIsFetching({ queryKey: ["projection"] }) > 0;
  useEffect(() => title.current?.focus({ preventScroll: true }), []);
  const cancel = rows.filter((x) => (decided[x.key] ?? (x.cancel ? "cancel" : null)) === "cancel");
  const lost = rows.filter((x) => failed[x.key] !== undefined);
  return (
    <section className="panel review-done">
      <span className="avatar pos" aria-hidden="true">
        <IconCheck />
      </span>
      <h2 ref={title} tabIndex={-1}>
        Pronto
      </h2>
      <p className="muted">
        {cancel.length === 0
          ? "Você manteve todas."
          : `${plural(cancel.length, "assinatura marcada", "assinaturas marcadas")} para cancelar. Cancele cada uma no app ou no site dela; quando a cobrança parar, ela vai para "Você já cortou".`}
      </p>
      {cancel.length > 0 && (
        <ul className="rows lead">
          {cancel.map((x) => (
            <li key={x.key} className="bill">
              <Tile text={x.description} />
              <span className="name">{nameOf(x)}</span>
              <span className="value">{money(x.amount)}</span>
              <span className="meta">{x.card}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="pos" aria-live="polite">
        {!reading && subs.toCancel > 0
          ? `Com todas as marcadas: ${money(subs.toCancel)} a menos por mês`
          : ""}
      </p>
      {lost.length > 0 && (
        <p className="warn" role="alert">
          Não salvou: {lost.map(nameOf).join(", ")}.{" "}
          <button type="button" className="text-link" onClick={onRetry}>
            Tentar de novo
          </button>
        </p>
      )}
      <div className="actions">
        <button type="button" onClick={onBack}>
          Voltar para Faturas
        </button>
        <button type="button" className="ghost" onClick={onAgain}>
          Revisar de novo
        </button>
      </div>
    </section>
  );
};

const FLING = 90;

/**
 * "Revisar uma a uma": the subscriptions without a decision, one at a time and biggest first, with
 * what each costs in a year; Manter or Vou cancelar, by button, arrow key or a swipe of the card
 * (Monarch's review, Tinder's gesture). All of them when every one has a decision already. The
 * list is fixed when it opens, so a decision never moves the next one.
 */
export const Review = ({ subs, onBack }: { subs: SubscriptionsView; onBack: () => void }) => {
  const queryClient = useQueryClient();
  const [rows] = useState(() => {
    const open = subs.items.filter((r) => !r.cancel && !r.kept);
    return open.length > 0 ? open : subs.items;
  });
  const [at, setAt] = useState(0);
  const [decided, setDecided] = useState<Record<string, "keep" | "cancel">>({});
  const [failed, setFailed] = useState<Record<string, "keep" | "cancel">>({});
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const r = rows[at] ?? null;
  const done = r === null;
  // Each decision is saved as it is made; the projection is read again once, at the end or on
  // leaving, not after every swipe.
  useEffect(() => {
    if (done) void queryClient.invalidateQueries({ queryKey: ["projection"] });
  }, [done, queryClient]);
  useEffect(
    () => () => void queryClient.invalidateQueries({ queryKey: ["projection"] }),
    [queryClient],
  );
  const save = (key: string, mark: "keep" | "cancel") =>
    api.markSubscription(key, { mark }).then(
      () => {
        setFailed(({ [key]: _, ...rest }) => rest);
        setDecided((d) => ({ ...d, [key]: mark }));
      },
      () => {
        // What did not save is not counted as decided: the end says which ones, to try again.
        setFailed((f) => ({ ...f, [key]: mark }));
        setDecided(({ [key]: _, ...rest }) => rest);
      },
    );
  const decide = (mark: "keep" | "cancel") => {
    if (!r) return;
    setDecided((d) => ({ ...d, [r.key]: mark }));
    setDx(0);
    setAt((i) => i + 1);
    void save(r.key, mark);
  };
  /** On to the next without deciding: it stays without a decision, for another day. */
  const skip = () => {
    setDx(0);
    setAt((i) => i + 1);
  };
  // At a keyboard the arrows decide, as the swipe does: → keeps, ← cancels. Never while typing
  // or with a sheet open.
  const onKey = useRef(decide);
  onKey.current = decide;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      if (document.querySelector("dialog[open]")) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
      )
        return;
      if (e.key === "ArrowRight") onKey.current("keep");
      else if (e.key === "ArrowLeft") onKey.current("cancel");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const marked = Object.values(decided).filter((m) => m === "cancel").length;

  if (!r)
    return (
      <ReviewDone
        subs={subs}
        rows={rows}
        decided={decided}
        failed={failed}
        onRetry={() =>
          void Promise.all(Object.entries(failed).map(([key, mark]) => save(key, mark))).then(() =>
            queryClient.invalidateQueries({ queryKey: ["projection"] }),
          )
        }
        onBack={onBack}
        onAgain={() => {
          setDecided({});
          setFailed({});
          setAt(0);
        }}
      />
    );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    start.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current !== null) setDx(e.clientX - start.current);
  };
  const onPointerUp = () => {
    if (start.current === null) return;
    start.current = null;
    if (Math.abs(dx) > FLING) decide(dx > 0 ? "keep" : "cancel");
    else setDx(0);
  };
  return (
    <section className="panel review">
      <div className="panel-head">
        <h2>Revisar assinaturas</h2>
        <span className="meta">
          {at + 1} de {rows.length}
        </span>
      </div>
      <div className="review-progress" aria-hidden="true">
        {rows.map((x, i) => (
          <i
            key={x.key}
            className={
              i < at ? (decided[x.key] === "cancel" ? "cut" : "done") : i === at ? "now" : undefined
            }
          />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {`${nameOf(r)}, ${money(r.amount)} por mês, ${at + 1} de ${rows.length}`}
      </p>
      <div
        key={r.key}
        className={`review-card${dx > 30 ? " keeping" : dx < -30 ? " cutting" : ""}`}
        style={
          dx ? { translate: `${dx}px 0`, rotate: `${dx / 25}deg`, transition: "none" } : undefined
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null;
          setDx(0);
        }}
      >
        <span className="verdict keep" aria-hidden="true">
          Manter
        </span>
        <span className="verdict cut" aria-hidden="true">
          Vou cancelar
        </span>
        <Tile text={r.description} />
        <h3>{nameOf(r)}</h3>
        <div className="sub-figure">
          <BigMoney cents={r.amount} tone="plain" />
          <span className="muted">por mês</span>
        </div>
        <p className="review-year">{money(r.amount * 12)} em um ano</p>
        <p className="hint">
          {r.card} · cobra no dia {dayOf(r)} · {plural(r.charges, "cobrança", "cobranças")}
        </p>
        <div className="review-chips">
          <Chips r={r} />
        </div>
      </div>
      {/* In the swipe's order: left cancels, right keeps. */}
      <div className="review-acts">
        <button type="button" className="ghost" onClick={() => decide("cancel")}>
          Vou cancelar
        </button>
        <button type="button" className="ghost" onClick={() => decide("keep")}>
          Manter
        </button>
      </div>
      <p className="hint review-how">
        <span className="coarse">Ou deslize: esquerda cancela, direita mantém.</span>
        <span className="fine">Ou use as setas: ← cancela, → mantém.</span>
      </p>
      <p className="review-sum" aria-live="polite">
        {marked > 0 ? `${plural(marked, "marcada", "marcadas")} para cancelar nesta revisão` : ""}
      </p>
      <div className="review-nav">
        {at > 0 && (
          <button type="button" className="text-link" onClick={() => setAt((i) => i - 1)}>
            Voltar uma
          </button>
        )}
        <button type="button" className="text-link quiet" onClick={skip}>
          Pular
        </button>
      </div>
    </section>
  );
};
