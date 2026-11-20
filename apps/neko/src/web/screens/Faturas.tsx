import { normalizeName } from "@neko/engine";
import {
  type MutationState,
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useCanGoBack, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import {
  type BuyGroup,
  type InvoiceMonthView,
  type InvoiceRow,
  invoicesView,
  type OwedView,
} from "../../shared/screens.ts";
import type { StatementAnswer } from "../../shared/types.ts";
import { api, reasonOf } from "../api.ts";
import { Board } from "../Board.tsx";
import { BrandMark } from "../BrandMark.tsx";
import { CardAvatar } from "../CardAvatar.tsx";
import { BigMoney, Columns } from "../Figures.tsx";
import { CardBill } from "../faturas/CardBill.tsx";
import { Person } from "../faturas/Person.tsx";
import { Review, Subscriptions } from "../faturas/Subscriptions.tsx";
import type { FaturasSearch } from "../faturas/search.ts";
import { monthOf, plural, shortMonth, stateLine } from "../faturas/text.ts";
import { bankText, capitalize, days, merchantName, money, shortDate } from "../format.ts";
import { Hint } from "../Hint.tsx";
import { IconChevron, IconChevronLeft } from "../icons.tsx";
import { CARDS_COME_FROM, HINTS } from "../learn.ts";
import { WithProjection } from "../useProjection.tsx";

/** A card's bill in the month's list: a tap opens its own page. */
const InvoiceLine = ({ c, month, today }: { c: InvoiceRow; month: string; today: string }) => {
  const gap = c.bank?.gap ?? 0;
  return (
    <li className="bill invoice nav">
      <Link
        className="row-toggle"
        to="/faturas"
        search={{ m: month, cartao: c.card }}
        aria-label={`${c.card}, ${money(c.amount)}: abrir a fatura`}
      />
      <CardAvatar name={c.card} />
      <span className="name">
        {c.card}
        {/* The bank only shows up when the sheet should change. */}
        {c.bank?.disagrees && (
          <span className="chip warn">
            Banco {gap > 0 ? "+" : "−"}
            {money(Math.abs(gap))}
          </span>
        )}
      </span>
      <span className="value">
        <span className="opens">
          {money(c.amount)}
          <IconChevron />
        </span>
      </span>
      <span className="meta">{stateLine(c, today)}</span>
    </li>
  );
};

/** One person in A receber: what they pay back on the month's bills, opening their page. */
const OwedLine = ({ o, month }: { o: OwedView; month: string }) => {
  const what = [o.card?.card, o.lines > 0 ? plural(o.lines, "compra", "compras") : null].filter(
    Boolean,
  );
  return (
    <li className="bill invoice nav">
      <Link
        className="row-toggle"
        to="/faturas"
        search={{ m: month, pessoa: o.person }}
        aria-label={`${o.person}, ${money(o.total)}: abrir`}
      />
      <span className="avatar person" aria-hidden="true">
        {o.person.slice(0, 1).toUpperCase()}
      </span>
      <span className="name">{o.person}</span>
      <span className="value">
        <span className="opens">
          {money(o.total)}
          <IconChevron />
        </span>
      </span>
      <span className="meta">
        {what.join(" e ")}
        {o.later > 0 && ` · mais ${money(o.later)} em parcelas`}
      </span>
    </li>
  );
};

/** Someone else's part of the month's bills: what each will pay back. */
const Owed = ({ m }: { m: InvoiceMonthView }) => (
  <section className="panel">
    <div className="panel-head">
      <h2>A receber</h2>
      <span className="meta">Faturas de {monthOf(m.key)}</span>
    </div>
    <ul className="rows lead invoices owed">
      {m.owed.map((o) => (
        <OwedLine key={o.person} o={o} month={m.key} />
      ))}
    </ul>
    <p className="hint">
      Fica fora do teto. A parte de cada pessoa aparece em Para lançar como Entrada.
    </p>
  </section>
);

const BuyLine = ({ g, best }: { g: BuyGroup; best: boolean }) => (
  <li className={`bill${best ? " best" : ""}`}>
    <CardAvatar name={g.cards[0] ?? ""} />
    <span className="name">{g.cards.join(", ")}</span>
    <span className="value">Paga em {days(g.payInDays)}</span>
    <span className="meta">
      Vence {shortDate(g.due)} · Melhor dia {g.estimated ? "≈ " : ""}
      {shortDate(g.bestDate)}
    </span>
  </li>
);

/** What a read of the bill PDF came to, in a sentence. */
const statementText = (a: StatementAnswer): string => {
  if (a.read) {
    const bill = `Fatura que vence em ${shortDate(a.due)} lida`;
    return a.added.length === 0
      ? `${bill}: ${plural(a.lines, "linha", "linhas")} em ${plural(a.cards, "cartão", "cartões")}, e o banco já tinha mandado todas.`
      : `${bill}. Entraram nela ${plural(a.added.length, "linha", "linhas")} que o banco não tinha mandado:`;
  }
  if (a.reason === "mismatch") {
    const card = a.problems?.find((p) => p.card)?.card;
    // A no-break space keeps "final" with its digits.
    return `As somas do PDF não fecharam${card ? ` no cartão final\u00a0${card}` : ""}, então nada foi guardado. Envie de novo para outra leitura.`;
  }
  if (a.reason === "account")
    return "Não achei esses cartões nos bancos ligados. Confira os cartões em Ajustes › Bancos.";
  if (a.reason === "paused")
    return `O limite de IA do mês acabou. Volta em ${shortDate(a.pausedUntil ?? "")}.`;
  return "Não consegui ler esse PDF. Se ele pede senha, salve uma cópia sem senha e envie de novo.";
};

/** A file the browser could not open: its own words, not "the connection dropped". */
class Unopened extends Error {}

const asBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Unopened());
    reader.readAsDataURL(file);
  });

const STATEMENT = ["statement"];

/**
 * The bank's own bill, as a PDF: its lines fill in what Open Finance left out (a credit, the
 * second of two equal purchases). Optional: the bill e-mailed to the Neko address is read alone.
 */
const StatementUpload = ({ month, onPick }: { month: string; onPick: (month: string) => void }) => {
  const queryClient = useQueryClient();
  const read = useMutation({
    mutationKey: STATEMENT,
    // The answer stays a while after leaving Faturas, as the lines it brought do.
    gcTime: 30 * 60_000,
    mutationFn: async (file: File) => api.readStatement(await asBase64(file)),
    onSuccess: async (a) => {
      if (a.read) await queryClient.invalidateQueries({ queryKey: ["projection"] });
    },
  });
  // The read outlives the screen: leaving Faturas and coming back finds it, still going or done.
  const last = useMutationState({
    filters: { mutationKey: STATEMENT },
    select: (m) => m.state as MutationState<StatementAnswer>,
  }).at(-1);
  const pending = last?.status === "pending";
  const answer = last?.status === "success" ? last.data : undefined;
  // The lines landed on the bill's own month, which may not be the one on screen.
  const elsewhere = answer?.read && answer.added.length > 0 && answer.due.slice(0, 7) !== month;
  return (
    <div className="statement">
      <label className="text-link">
        Ler a fatura do banco (PDF)
        <input
          type="file"
          accept="application/pdf"
          className="sr-only"
          // Not `disabled`: that would drop the focus while the read goes on.
          aria-disabled={pending}
          onClick={(e) => {
            if (pending) e.preventDefault();
          }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) read.mutate(file);
          }}
        />
      </label>
      <div aria-live="polite">
        {pending && <p className="hint">Lendo a fatura. Leva uns 2 minutos…</p>}
        {answer && <p className={answer.read ? "hint" : "warn"}>{statementText(answer)}</p>}
        {answer?.read && answer.added.length > 0 && (
          <div className="bank-lines">
            <ul>
              {answer.added.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: two equal lines are two lines here.
                <li key={`${l.card}-${l.description}-${i}`}>
                  <span className="text">
                    {bankText(merchantName(l.description))}
                    <small>{l.card}</small>
                  </span>
                  <span>{money(l.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {answer?.read && elsewhere && (
          <button
            type="button"
            className="text-link"
            onClick={() => onPick(answer.due.slice(0, 7))}
          >
            Ver {monthOf(answer.due.slice(0, 7))}
          </button>
        )}
        {last?.status === "error" && (
          <p className="warn">
            {last.error instanceof Unopened
              ? "Não consegui abrir esse arquivo. Tente de novo."
              : reasonOf(last.error)}
          </p>
        )}
      </div>
    </div>
  );
};

/** Back to the month's bills: a step back when Faturas was the step before, else there. */
const Back = ({ label, month }: { label: string; month: string }) => {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const navigate = useNavigate({ from: "/faturas" });
  return (
    <button
      type="button"
      className="text-link back-link"
      aria-keyshortcuts="Escape"
      title={`${label} (Esc)`}
      onClick={() =>
        canGoBack ? router.history.back() : navigate({ search: { m: month }, replace: true })
      }
    >
      <IconChevronLeft />
      {label}
    </button>
  );
};

/** A page that is not there any more (the month moved on, the mark was taken off). */
const Gone = ({ text, month }: { text: string; month: string }) => (
  <>
    <Back label={`Faturas de ${monthOf(month)}`} month={month} />
    <section className="panel">
      <p className="muted">{text}</p>
    </section>
  </>
);

export const Faturas = () => {
  // The month and what is open over it live in the URL: back closes it, reload keeps it.
  const search = useSearch({ from: "/faturas" });
  const navigate = useNavigate({ from: "/faturas" });
  const setPicked = (m: string) =>
    navigate({ search: (s: FaturasSearch) => ({ ...s, m }), replace: true, viewTransition: false });
  return (
    <WithProjection>
      {(r) => {
        const v = invoicesView(r);
        if (!v.hasCards || v.months.length === 0)
          return (
            <section className="page-head empty-cards">
              <BrandMark width={64} className="quiet-mark" />
              <h2>Nenhuma fatura</h2>
              <p className="muted">{CARDS_COME_FROM}</p>
            </section>
          );
        const m =
          v.months.find((x) => x.key === (search.m ?? v.current)) ?? (v.months.at(-1) as never);
        const waits = v.onArrival;
        const back = <Back label={`Faturas de ${monthOf(m.key)}`} month={m.key} />;
        if (search.cartao) {
          const c = m.cards.find(
            (x) => normalizeName(x.card) === normalizeName(search.cartao ?? ""),
          );
          if (!c)
            return (
              <Gone text={`${search.cartao} não tem fatura em ${monthOf(m.key)}.`} month={m.key} />
            );
          return (
            <>
              {back}
              <CardBill
                key={`${c.card}|${m.key}`}
                c={c}
                month={m.key}
                today={v.today}
                people={v.people}
                waits={waits}
                onPickMonth={setPicked}
              />
            </>
          );
        }
        if (search.pessoa) {
          const o = m.owed.find(
            (x) => normalizeName(x.person) === normalizeName(search.pessoa ?? ""),
          );
          if (!o)
            return (
              <Gone
                text={`Nada de ${search.pessoa} nas faturas de ${monthOf(m.key)}.`}
                month={m.key}
              />
            );
          return (
            <>
              {back}
              <Person o={o} month={m.key} people={v.people} waits={waits} />
            </>
          );
        }
        if (search.revisar) {
          if (!v.subscriptions)
            return <Gone text="Nenhuma assinatura para revisar." month={m.key} />;
          return (
            <>
              {back}
              <Review
                subs={v.subscriptions}
                onBack={() => navigate({ search: { m: m.key }, replace: true })}
              />
            </>
          );
        }
        const [best, ...rest] = v.buyToday;
        const ahead = v.months.some((x) => x.future);
        return (
          <Board
            panels={{
              months: (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Por mês</h2>
                    {v.bank?.syncedAt && (
                      <span className="meta">
                        Banco lido {shortDate(v.bank.syncedAt.slice(0, 10))}
                      </span>
                    )}
                  </div>
                  <div className="figure-stack">
                    <span className="muted">
                      {m.past ? "Saiu da conta" : "Sai da conta"} em {monthOf(m.key)}
                    </span>
                    <BigMoney cents={m.total} tone="plain" />
                    {m.bank &&
                      (m.bank.disagree === 0 ? (
                        <span className="pos">✓ Banco não ultrapassa a planilha</span>
                      ) : (
                        <>
                          <span className="warn">
                            {m.bank.disagree === 1
                              ? `${m.cards.find((x) => x.bank?.disagrees)?.card ?? "1 cartão"} não confere com o banco`
                              : `${m.bank.disagree} cartões não conferem com o banco`}
                          </span>
                          {/* Para lançar has the change for each one: nothing is written without a tap. */}
                          <Link className="text-link" to="/" hash="h-queue">
                            Corrigir em Para lançar{" "}
                            <span aria-hidden="true">›</span>
                          </Link>
                        </>
                      ))}
                  </div>
                  <Columns
                    label="Faturas de todos os cartões, por mês de vencimento"
                    selected={m.key}
                    onSelect={setPicked}
                    guide={v.average}
                    items={v.months.map((x) => ({
                      key: x.key,
                      label: shortMonth(x.key),
                      value: x.total,
                      description: `${capitalize(monthOf(x.key))}: ${money(x.total)}${x.future ? ", já na planilha" : ""}`,
                      tone:
                        x.key === m.key
                          ? x.future
                            ? "outline"
                            : "ink"
                          : x.future
                            ? "faint"
                            : undefined,
                    }))}
                  />
                  <p className="columns-key">
                    {v.average !== null && (
                      <span>
                        <i className="key dashed" />
                        Média {money(v.average)}
                      </span>
                    )}
                    {ahead && (
                      <span>
                        <span className="swatch" aria-hidden="true" />
                        Meses à frente: só o que já está na planilha
                      </span>
                    )}
                  </p>

                  <Hint id="faturas">{HINTS.faturas}</Hint>
                </section>
              ),
              cards: (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Cartões</h2>
                    <span className="meta">Vencem em {monthOf(m.key)}</span>
                  </div>
                  {m.cards.length === 0 ? (
                    <p className="hint">Nenhuma fatura neste mês.</p>
                  ) : (
                    <ul className="rows lead invoices">
                      {m.cards.map((c) => (
                        <InvoiceLine key={c.card} c={c} month={m.key} today={v.today} />
                      ))}
                    </ul>
                  )}
                  {v.bank && <StatementUpload month={m.key} onPick={setPicked} />}
                </section>
              ),
              owed: m.owed.length > 0 && <Owed m={m} />,
              buy: best && (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Comprar hoje</h2>
                    <span className="meta">Mais prazo primeiro</span>
                  </div>
                  <ul className="rows lead">
                    <BuyLine g={best} best />
                  </ul>
                  {rest.length > 0 && (
                    <details className="formula more-buy">
                      <summary>
                        Ver todos
                        <IconChevron />
                      </summary>
                      <ul className="rows lead">
                        {rest.map((g) => (
                          <BuyLine key={`${g.due}-${g.cards.join()}`} g={g} best={false} />
                        ))}
                      </ul>
                    </details>
                  )}
                  {v.buyToday.some((g) => g.estimated) && (
                    <Link className="text-link" to="/ajustes">
                      Dias com ≈ são estimados. Corrigir em Ajustes
                    </Link>
                  )}
                </section>
              ),
              subs: v.subscriptions && (
                <Subscriptions
                  subs={v.subscriptions}
                  month={m.key}
                  people={v.people}
                  waits={waits}
                />
              ),
            }}
            // Wide screens: the months beside the month's cards, then where to buy.
            two={[["months"], ["cards", "owed", "buy", "subs"]]}
            three={[["months"], ["cards", "owed"], ["buy", "subs"]]}
          />
        );
      }}
    </WithProjection>
  );
};
