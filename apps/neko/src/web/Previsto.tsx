import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { PrevistoView } from "../shared/types.ts";
import { api } from "./api.ts";
import { money, shortDate, toCents } from "./format.ts";
import { IconChevron } from "./icons.tsx";
import { showToast } from "./Launch.tsx";

/**
 * The Diário previsto (specs/005-lancamentos, Fase 3): a switch in Ajustes that fills the days
 * ahead with what a usual day costs, and the review on Hoje every 3 months. The values come from
 * the Worker; nothing here computes one.
 */

const reais = (c: number) => (c / 100).toFixed(2).replace(".", ",");

const nearest = (el: Element | null) => el?.scrollIntoView({ block: "nearest" });

const useSetPrevisto = (onDone: () => void) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: number) => {
      const r = await api.previsto(value);
      if (r.state !== "done")
        throw new Error(r.error ?? "Não gravou. A planilha ficou como estava.");
      return { ...r, value };
    },
    onSuccess: (r) => {
      showToast({
        entryId: r.entryId,
        text:
          r.value > 0 ? `Diário previsto: ${money(r.value)} por dia` : "Diário previsto desligado",
      });
      onDone();
      queryClient.invalidateQueries();
    },
  });
};

const failure = (e: unknown) =>
  e instanceof Error && e.message
    ? e.message.replace(/^./, (c) => c.toUpperCase())
    : "Não gravou. Confira a conexão e tente de novo.";

/** Ajustes › Planilha: on, off, and the value per day. */
export const PrevistoSetting = ({
  previsto: p,
  writing,
}: {
  previsto: PrevistoView;
  writing: boolean;
}) => {
  const id = useId();
  const [open, setOpen] = useState<"on" | "off" | null>(null);
  const [typed, setTyped] = useState("");
  const run = useSetPrevisto(() => setOpen(null));
  const amount = toCents(typed);
  // As in Ritmo, a wrong value is pointed out once you leave the field, not while typing.
  const [left, setLeft] = useState(false);
  const bad = left && typed.trim() !== "" && (amount === null || amount <= 0);
  const actions = useRef<HTMLDivElement>(null);
  // The form opens below the switch and grows (Como calculei, the error): keep its buttons
  // above the dock.
  useEffect(() => {
    if (open === "on" || bad) nearest(actions.current);
  }, [open, bad]);
  const start = () => {
    const value = p.on ? p.value : (p.suggestion?.perDay ?? 0);
    setTyped(value > 0 ? reais(value) : "");
    setLeft(false);
    run.reset();
    setOpen("on");
  };
  const s = p.suggestion;
  return (
    <>
      <label className="setting">
        <span className="label">
          Diário previsto
          <span className="sub" aria-live="polite">
            {!writing
              ? "Ligue Lançar pelo Neko para usar"
              : open === "off"
                ? "Confirme abaixo para desligar"
                : p.on
                  ? `${money(p.value)} por dia nos dias que vêm`
                  : "Desligado"}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          aria-checked={p.on}
          checked={p.on}
          disabled={!writing || run.isPending}
          onChange={(e) => {
            if (e.target.checked) start();
            else {
              run.reset();
              setOpen("off");
            }
          }}
        />
      </label>
      {p.on && writing && open === null && (
        <button type="button" className="setting quiet" onClick={start}>
          Trocar o valor
        </button>
      )}
      {open === "on" && (
        <form
          className="sim entry previsto"
          aria-label="Diário previsto"
          onSubmit={(e) => {
            e.preventDefault();
            setLeft(true);
            if (amount !== null && amount > 0) run.mutate(amount);
          }}
        >
          {s && (
            <>
              <p className="q-lines">
                <span>Pelo banco, um dia seu custa {money(s.perDay)}.</span>
              </p>
              <details className="formula" onToggle={() => nearest(actions.current)}>
                <summary>
                  <IconChevron />
                  Como calculei
                </summary>
                <p>
                  Desde {shortDate(s.from)}: {money(s.cards)} em compras nos seus cartões e{" "}
                  {money(s.pix)} em Pix e débito, sem o que a planilha já planeja, divididos por{" "}
                  {s.days} dias. Compra parcelada conta inteira no dia em que foi feita.
                </p>
              </details>
            </>
          )}
          <label className="field" htmlFor={`${id}-v`}>
            Valor por dia
          </label>
          <span className="affix big">
            <span aria-hidden="true">R$</span>
            <input
              id={`${id}-v`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={typed}
              aria-invalid={bad}
              aria-describedby={bad ? `${id}-e` : undefined}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => setLeft(true)}
            />
          </span>
          {bad && (
            <p id={`${id}-e`} className="hint error">
              Use um valor como 95,00
            </p>
          )}
          <p className="hint">
            Cada dia de hoje até dezembro de {p.lastYear} recebe esse valor no Diário, com a nota
            Previsto. O que você escreveu no Diário fica como está.
          </p>
          {run.isError && (
            <p className="setting-error" role="alert">
              {failure(run.error)}
            </p>
          )}
          <div className="actions" ref={actions}>
            <button type="submit" disabled={amount === null || amount <= 0 || run.isPending}>
              {run.isPending ? "Gravando…" : p.on ? "Trocar" : "Preencher"}
            </button>
            <button type="button" className="ghost" onClick={() => setOpen(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {open === "off" && (
        <section
          className="sim entry previsto"
          aria-label="Desligar o Diário previsto"
          tabIndex={-1}
          // A screen reader reads what turning it off does, not just the switch; the switch stays
          // in sight.
          ref={(el) => {
            el?.focus({ preventScroll: true });
            el?.scrollIntoView({ block: "nearest" });
          }}
        >
          <p className="hint">
            O previsto sai dos dias que vêm. O que você escreveu no Diário fica como está.
          </p>
          {run.isError && (
            <p className="setting-error" role="alert">
              {failure(run.error)}
            </p>
          )}
          <div className="actions">
            <button type="button" disabled={run.isPending} onClick={() => run.mutate(0)}>
              {run.isPending ? "Apagando…" : "Apagar o previsto"}
            </button>
            <button type="button" className="ghost" onClick={() => setOpen(null)}>
              Cancelar
            </button>
          </div>
        </section>
      )}
    </>
  );
};

/** Hoje, every 3 months: what a day really cost beside the value, and whether to change it. */
export const PrevistoReview = ({ previsto: p }: { previsto: PrevistoView | undefined }) => {
  const queryClient = useQueryClient();
  const change = useSetPrevisto(() => undefined);
  const keep = useMutation({
    mutationFn: api.keepPrevisto,
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const r = p?.review;
  if (!p?.on || !r) return null;
  const busy = change.isPending || keep.isPending;
  const error = change.error ?? keep.error;
  return (
    <section className="panel" aria-labelledby="h-previsto">
      <div className="panel-head">
        <h2 id="h-previsto">Diário previsto</h2>
        <span className="meta">A cada 3 meses</span>
      </div>
      <dl className="ledger">
        <dt>Previsto por dia</dt>
        <dd>{money(p.value)}</dd>
        <dt>Gasto por dia desde {shortDate(r.from)}</dt>
        <dd>{money(r.real)}</dd>
      </dl>
      <div className="q-actions">
        {r.real !== p.value && (
          <button
            type="button"
            className="small"
            disabled={busy}
            onClick={() => change.mutate(r.real)}
          >
            {change.isPending ? "Trocando…" : `Trocar para ${money(r.real)}`}
          </button>
        )}
        <button type="button" className="ghost small" disabled={busy} onClick={() => keep.mutate()}>
          Manter {money(p.value)}
        </button>
      </div>
      {error && (
        <p className="setting-error" role="alert">
          {failure(error)}
        </p>
      )}
    </section>
  );
};
