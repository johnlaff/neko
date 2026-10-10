import {
  addDays,
  groupUpcomingByDay,
  type HealthIssue,
  type Insight,
  type MonthRecap,
  type Saving,
  type UpcomingDay,
} from "@neko/engine";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { HEALTH_DAYS, issueKey, SAVE_LEAD } from "../../shared/today.ts";
import { api, type DailySource, type ProjectionResponse } from "../api.ts";
import { Board } from "../Board.tsx";
import { BrandMark } from "../BrandMark.tsx";
import { RowAvatar } from "../CardAvatar.tsx";
import { CategoryIcon } from "../CategoryIcon.tsx";
import { BigMoney, Gauge, ItemName } from "../Figures.tsx";
import {
  capitalize,
  days,
  money,
  monthName,
  relativeDay,
  sheetCellUrl,
  shortDate,
  signed,
} from "../format.ts";
import { Hint } from "../Hint.tsx";
import {
  IconCard,
  IconChevron,
  IconExternal,
  IconIncome,
  IconPlus,
  IconReceipt,
} from "../icons.tsx";
import { LaunchToast, ManualLaunch, ParaLancar } from "../Launch.tsx";
import { CARDS_COME_FROM, HINTS } from "../learn.ts";
import { Mia } from "../Mia.tsx";
import { Simulator } from "../Pace.tsx";
import { PrevistoReview } from "../Previsto.tsx";
import { Streak } from "../Streak.tsx";
import { WithProjection } from "../useProjection.tsx";
import { Wins } from "../Wins.tsx";

/** Each warning in a few words, with the figure that shows it and where to look next. */
const insightView = (i: Insight) => {
  switch (i.kind) {
    case "goes-negative":
      return {
        tone: "bad",
        to: "/mes",
        month: i.start.slice(0, 7),
        title: i.already
          ? "Saldo negativo agora"
          : `Saldo negativo a partir de ${shortDate(i.start)}`,
        detail:
          i.already && i.until
            ? `Positivo de novo em ${shortDate(i.until)}. No pior dia, faltam ${money(-i.deepest)}`
            : `No pior dia, ${shortDate(i.deepestDate)}, faltam ${money(-i.deepest)}`,
      } as const;
    case "no-spending-ahead":
      return {
        tone: "warn",
        to: "/mes",
        month: `${i.year}-${String(i.month).padStart(2, "0")}`,
        title: `${capitalize(monthName(i.month))} ainda sem gastos previstos`,
        detail: "Sem diário nem fatura lançados, esse saldo ainda está alto",
      } as const;
    case "bill-above-average":
      return {
        tone: "warn",
        to: "/faturas",
        title: "Fatura acima do normal",
        detail: `${i.card}: ${money(i.over)} acima da média`,
      } as const;
    case "fixed-up":
      return {
        tone: "warn",
        to: "/mes",
        title: `${capitalize(i.label)} subiu`,
        detail: `${money(i.amount)} este mês, ${money(i.change)} a mais`,
      } as const;
    case "closing-estimated":
      return {
        // A setup question, not a warning: color stays for real deviations.
        tone: "ask",
        to: "/ajustes",
        title: `Qual dia fecha o ${i.card}?`,
        detail: `Fecha ≈ ${shortDate(i.closing)}. Confirme em Ajustes`,
      } as const;
    default:
      // A copy cached by an older version can carry a kind this one no longer knows.
      return null;
  }
};

/** Only problems worth acting on; nothing at all when everything is calm. */
/** Warnings in view at once; the rest wait behind one quiet line, most important first. */
const SHOWN_ALERTS = 2;

const Insights = ({ items }: { items: readonly Insight[] }) => {
  const known = items.filter((i) => insightView(i) !== null);
  const rest = known.slice(SHOWN_ALERTS);
  if (known.length === 0) return null;
  return (
    <>
      <AlertList items={known.slice(0, SHOWN_ALERTS)} />
      {rest.length > 0 && (
        <details className="more-alerts">
          <summary>{rest.length === 1 ? "Mais 1 aviso" : `Mais ${rest.length} avisos`}</summary>
          <AlertList items={rest} />
        </details>
      )}
    </>
  );
};

const AlertList = ({ items }: { items: readonly Insight[] }) => (
  <ul className="alerts" aria-label="Avisos">
    {items.map((i) => {
      const v = insightView(i);
      if (!v) return null;
      return (
        <li key={i.kind}>
          <Link to={v.to} search={"month" in v ? { m: v.month } : {}} className={`alert ${v.tone}`}>
            <span className="alert-dot" aria-hidden="true" />
            <span className="alert-text">
              <strong>{v.title}</strong>
              <span>{v.detail}</span>
            </span>
            <IconChevron />
          </Link>
        </li>
      );
    })}
  </ul>
);

/**
 * The payday nudge as an active choice (pay yourself first): the amount, the day, and the proof
 * that the account still holds. Neko never moves money, so it only says how much fits.
 */
const SaveCard = ({ save, today }: { save: Saving; today: string }) => {
  const isToday = save.date === today;
  return (
    <ul className="alerts" aria-label="Guardar">
      <li>
        <Link to="/mes" search={{ m: save.date.slice(0, 7) }} className="alert good">
          <span className="alert-dot" aria-hidden="true" />
          <span className="alert-text">
            <strong>
              {isToday
                ? `Na conta, dá para guardar ${money(save.amount)} hoje`
                : `${relativeDay(save.date, today)}: dá para guardar ${money(save.amount)}`}
            </strong>
            <span>
              Depois de guardar, menor saldo até {shortDate(save.until)}: {money(save.leftAtLowest)}
            </span>
          </span>
          <IconChevron />
        </Link>
      </li>
    </ul>
  );
};

const COLUMN = { entrada: "Entrada", saida: "Saída", diario: "Diário" } as const;

/** What is off, in a few words, and the figures that show it. */
const issueText = (i: HealthIssue): { title: string; detail: string } => {
  switch (i.kind) {
    case "missing-date":
      return { title: "Data vazia", detail: "A linha não tem data na planilha" };
    case "note-mismatch":
      return {
        title: `${COLUMN[i.column]} não bate com a nota`,
        detail: `Nota ${money(i.notes)} · Célula ${money(i.cell)}`,
      };
    case "balance-mismatch":
      return {
        title: "Saldo não bate",
        detail: `Planilha ${money(i.sheet)} · Pela soma ${money(i.computed)}`,
      };
    case "missing-bill":
      return {
        title: `Fatura ${i.card} não lançada`,
        detail: "Venceu e não tem linha na nota de Saída",
      };
    case "unparsed-note":
      return { title: `${COLUMN[i.column]}: nota não entendida`, detail: `"${i.lines[0] ?? ""}"` };
  }
};

const dailySourceText = (source: DailySource) =>
  source === "settings"
    ? "seu ajuste"
    : source === "sheet-note"
      ? "da nota na planilha"
      : "média dos últimos 3 meses";

const IssueList = ({
  items,
  sheet,
}: {
  items: readonly HealthIssue[];
  sheet: ProjectionResponse["sheet"];
}) => (
  <ul className="rows">
    {items.map((i) => {
      const t = issueText(i);
      return (
        <li key={`${i.kind}-${i.ref.tab}-${i.ref.a1}`}>
          <a
            className="row-link"
            href={sheetCellUrl(sheet.id, sheet.tabs[i.ref.tab], i.ref.a1)}
            target="_blank"
            rel="noreferrer"
          >
            <span className="name">{t.title}</span>
            <span className="value muted">
              {shortDate(i.date)}
              <IconExternal />
              <span className="sr-only">, abre o dia na planilha</span>
            </span>
            <span className="meta">{t.detail}</span>
          </a>
        </li>
      );
    })}
  </ul>
);

/**
 * Sheet points the method says should hold but do not. Ones already checked can be set aside, so
 * an old difference nobody will fix does not keep the panel yellow; a new one shows up again.
 */
const Conference = ({
  issues,
  sheet,
}: {
  issues: readonly HealthIssue[];
  sheet: ProjectionResponse["sheet"];
}) => {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const review = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (saved) => queryClient.setQueryData(["settings"], saved),
  });
  // What the last tap hid, so it can come back with one more tap.
  const [justHid, setJustHid] = useState<readonly string[] | null>(null);
  const seen = new Set(settings.data?.reviewed ?? []);
  const open = issues.filter((i) => !seen.has(issueKey(i)));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Conferência</h2>
        <span className={`chip ${open.length === 0 ? "ok" : "warn"}`}>
          {open.length === 0
            ? "Tudo certo"
            : open.length === 1
              ? "1 ponto"
              : `${open.length} pontos`}
        </span>
      </div>
      {/* All clear is the title and its chip alone: a sentence saying so again only adds height. */}
      {open.length > 0 && (
        <>
          <IssueList items={open} sheet={sheet} />
          {settings.data && (
            <button
              type="button"
              className="text-link"
              disabled={review.isPending}
              onClick={() => {
                const s = settings.data;
                const keys = open.map(issueKey);
                const reviewed = [...s.reviewed, ...keys].slice(-300);
                review.mutate({ ...s, reviewed }, { onSuccess: () => setJustHid(keys) });
              }}
            >
              {review.isPending
                ? "Escondendo…"
                : open.length === 1
                  ? "Já conferi, esconder este"
                  : `Já conferi, esconder os ${open.length}`}
            </button>
          )}
        </>
      )}
      {open.length === 0 && justHid && settings.data && (
        <p className="hint" role="status">
          {justHid.length === 1 ? "1 ponto escondido." : `${justHid.length} pontos escondidos.`}{" "}
          <button
            type="button"
            className="text-link"
            disabled={review.isPending}
            onClick={() => {
              const s = settings.data;
              const back = new Set(justHid);
              review.mutate(
                { ...s, reviewed: s.reviewed.filter((k) => !back.has(k)) },
                { onSuccess: () => setJustHid(null) },
              );
            }}
          >
            {review.isPending ? "Desfazendo…" : "Desfazer"}
          </button>
        </p>
      )}
      {review.isError && (
        <p className="setting-error" role="status">
          Não salvou. Tente de novo.
        </p>
      )}
    </section>
  );
};

/** Days shown before "Ver mais": whole days only, until about this many items. */
const UPCOMING_SHOWN = 4;

const KIND_ICON = { card: IconCard, bill: IconReceipt, income: IconIncome } as const;

const Days = ({ days, today }: { days: readonly UpcomingDay[]; today: string }) => (
  <div className="days">
    {days.map((d) => (
      <section key={d.date} className="day" aria-label={relativeDay(d.date, today)}>
        <header className="day-head">
          <h3>{relativeDay(d.date, today)}</h3>
          {/* The day's total only adds up more than one line; with one, it repeated the row. */}
          {d.items.length > 1 && (
            <span className={d.net > 0 ? "pos" : undefined}>
              {signed(Math.abs(d.net), d.net > 0 ? "+" : "−")}
            </span>
          )}
        </header>
        <ul className="rows lead">
          {d.items.map((u) => {
            const Icon = KIND_ICON[u.kind];
            return (
              <li key={`${u.kind}-${u.description}-${u.amount}`}>
                <RowAvatar
                  card={u.kind === "card" ? u.description : null}
                  className={`avatar${u.kind === "income" ? " pos" : ""}`}
                >
                  {u.kind === "card" ? (
                    <Icon />
                  ) : (
                    <CategoryIcon text={u.description} fallback={<Icon />} />
                  )}
                </RowAvatar>
                <span className="name">
                  <ItemName text={u.description || "Sem descrição"} />
                </span>
                <span className={`value${u.kind === "income" ? " pos" : ""}`}>
                  {signed(u.amount, u.kind === "income" ? "+" : "−")}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    ))}
  </div>
);

/** Whole days up to about UPCOMING_SHOWN items, and the rest. */
const splitDays = (days: readonly UpcomingDay[]) => {
  let count = 0;
  let cut = 0;
  while (
    cut < days.length &&
    (cut === 0 || count + (days[cut]?.items.length ?? 0) <= UPCOMING_SHOWN)
  ) {
    count += days[cut]?.items.length ?? 0;
    cut += 1;
  }
  return [days.slice(0, cut), days.slice(cut)] as const;
};

/**
 * The month that just closed, in the first week of the next: how it ended, what it kept, what it
 * cost to live and where most of it went. A plain panel: it informs, it does not warn.
 */
const RecapPanel = ({ r }: { r: MonthRecap }) => {
  const name = monthName(r.month);
  return (
    <section className="panel recap">
      <div className="panel-head">
        <h2>{capitalize(name)} fechou</h2>
        <Link
          to="/mes"
          search={{ m: `${r.year}-${String(r.month).padStart(2, "0")}` }}
          className="text-link"
        >
          Ver o mês
        </Link>
      </div>
      <Wins wins={r.wins} year={r.year} month={r.month} />
      <dl className="ledger">
        <dt>{r.result < 0 ? "Faltou" : "Sobrou"}</dt>
        <dd className={r.result > 0 ? "pos" : r.result < 0 ? "neg" : undefined}>
          {money(Math.abs(r.result))}
        </dd>
        {r.saved > 0 && (
          <>
            <dt>Guardado{r.savedShare !== null && ` · ${r.savedShare}% das entradas`}</dt>
            <dd>{money(r.saved)}</dd>
          </>
        )}
        {/* Custo de vida and the largest line are one tap away, on Mês. */}
      </dl>
    </section>
  );
};

/**
 * The day the run reaches a mark or passes its best before, and the day after: one card, then
 * it leaves on its own. A mark wins when both land on the same day.
 */
export const Hoje = () => (
  <WithProjection>
    {({ projection: p, sheet, daily, habit, bank, writing, cardsKnown, previsto }) => {
      const cs = p.canSpend;
      const todayUrl = p.todayRef
        ? sheetCellUrl(sheet.id, sheet.tabs[p.todayRef.tab], p.todayRef.a1)
        : null;
      // Same window the copy promises: the last 60 days and anything ahead.
      const since = addDays(p.today, -HEALTH_DAYS);
      const issues = p.health.filter((i) => i.date >= since).reverse();
      const over = cs !== null && cs.perDay < 0;
      // With the Diário previsto on, the dial is the month's: cards and Pix against the Diário.
      const month = cs?.mode === "month";
      const [shown, rest] = splitDays(groupUpcomingByDay(p.upcoming));
      return (
        <>
          <Board
            panels={{
              dial: cs ? (
                <section className="panel hero today">
                  <div className="panel-head">
                    <h2>
                      {month ? `Diário de ${monthName(Number(p.today.slice(5, 7)))}` : cs.card}
                    </h2>
                    {/* Over the plan, the figure already says so in red, and behind the Diário the line
                    under it says by how much: the chip would repeat either. */}
                    {!over && !(month && cs.daysBehind > 0) && (
                      <span className={`chip ${cs.paceGap >= 0 ? "ok" : "warn"}`}>
                        {cs.paceGap >= 0
                          ? "No ritmo"
                          : month
                            ? "Acima do previsto"
                            : "Acima do ritmo"}
                      </span>
                    )}
                  </div>
                  <div className="dial">
                    <Gauge
                      value={cs.accumulated}
                      total={cs.budget}
                      mark={cs.paceExpected}
                      over={over || cs.paceGap < 0}
                      bad={over}
                    />
                    <p className="dial-label">
                      <span className="caption">{over ? "Passou do plano" : "Hoje cabem"}</span>
                      <BigMoney
                        cents={over ? cs.overBy : cs.perDay}
                        tone={over ? "neg" : undefined}
                      />
                      <span className="caption">
                        {over
                          ? month
                            ? "neste mês"
                            : "neste ciclo"
                          : cs.daysLeft === 1
                            ? month
                              ? "até o mês acabar, hoje"
                              : "até a fatura fechar, hoje"
                            : "por dia"}
                      </span>
                    </p>
                  </div>
                  {/* How far ahead of the Diário the month went, in days without spending. */}
                  {month && cs.daysBehind > 0 && !over && (
                    <p className="behind">
                      {money(-cs.paceGap)} acima do previsto. Uns {days(cs.daysBehind)} sem gastar e
                      você volta ao previsto.
                    </p>
                  )}
                  {cs.daysLeft > 1 && (
                    <div className="chips">
                      <span className="chip plain">
                        {month ? "Até" : "Fecha"} {shortDate(cs.closing)} · {days(cs.daysLeft)}
                      </span>
                    </div>
                  )}
                  <details className="formula">
                    <summary>
                      <IconChevron />
                      Como calculei
                    </summary>
                    {month ? (
                      <>
                        <p>
                          {money(cs.budget)} de Diário previsto no mês ({money(p.dailyForecast)} por
                          dia) menos {money(cs.accumulated)} gastos até ontem nos seus cartões e no
                          Pix, como o banco mostra, dividido por {days(cs.daysLeft)}.
                        </p>
                        <p>
                          O ponto no arco é o previsto até ontem: o mês está{" "}
                          {money(Math.abs(cs.paceGap))} {cs.paceGap >= 0 ? "abaixo" : "acima"} dele.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          {money(cs.budget)}{" "}
                          {cs.budgetSource === "diario"
                            ? `de diário no ciclo (${money(p.dailyForecast)} por dia, ${dailySourceText(daily.source)})`
                            : "planejados para o ciclo"}{" "}
                          menos {money(cs.accumulated)} na fatura, dividido por {days(cs.daysLeft)}.
                        </p>
                        <p>
                          O ponto no arco é o ritmo de hoje: a fatura está{" "}
                          {money(Math.abs(cs.paceGap))} {cs.paceGap >= 0 ? "abaixo" : "acima"} dele.
                        </p>
                      </>
                    )}
                  </details>
                  <Hint id="hoje">{month ? HINTS.hojeMes : HINTS.hoje}</Hint>
                </section>
              ) : (
                <section className="page-head empty-cards">
                  <BrandMark width={64} className="quiet-mark" />
                  <h2>Nenhum cartão na planilha</h2>
                  <p className="muted">{CARDS_COME_FROM}</p>
                </section>
              ),
              quick: (
                <div className="quick">
                  {writing ? (
                    <ManualLaunch
                      cards={cardsKnown.filter((c) => !c.closingEstimated).map((c) => c.name)}
                      today={p.today}
                    />
                  ) : (
                    todayUrl && (
                      <a
                        className="button"
                        href={todayUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-keyshortcuts="L"
                        title="Lançar na planilha (L)"
                      >
                        <IconPlus />
                        Lançar
                      </a>
                    )
                  )}
                  {cs && <Simulator cs={cs} months={p.months} />}
                  <Mia />
                </div>
              ),
              streak: habit && <Streak habit={habit} />,
              previsto: <PrevistoReview previsto={previsto} />,
              // Over the plan, the red figure already says the bill is high: no second card.
              insights: (
                <Insights
                  items={(p.insights ?? []).filter(
                    (i) => !(over && i.kind === "bill-above-average"),
                  )}
                />
              ),
              save: p.saving &&
                p.saving.date >= p.today &&
                p.saving.date <= addDays(p.today, SAVE_LEAD) && (
                  <SaveCard save={p.saving} today={p.today} />
                ),
              // Missing on projections cached before it existed.
              recap: p.recap && <RecapPanel r={p.recap} />,
              next: (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Próximos 7 dias</h2>
                    {p.upcoming.length > 0 && (
                      <span className="meta">{p.upcoming.length} itens</span>
                    )}
                  </div>
                  {p.upcoming.length === 0 ? (
                    <p className="muted">Nada lançado nos próximos 7 dias.</p>
                  ) : (
                    <>
                      <Days days={shown} today={p.today} />
                      {rest.length > 0 && (
                        <details className="formula">
                          <summary>
                            <IconChevron />
                            Ver mais {rest.length === 1 ? "1 dia" : `${rest.length} dias`}
                          </summary>
                          <Days days={rest} today={p.today} />
                        </details>
                      )}
                    </>
                  )}
                </section>
              ),
              queue: bank && <ParaLancar bank={bank} writing={writing ?? false} today={p.today} />,
              conference: <Conference issues={issues} sheet={sheet} />,
            }}
            // Wide screens: each column takes the next panels in the phone's order, so the eye and
            // the keyboard go down one column and then the next. Today's number and what to do now,
            // then what to know, then what the bank found.
            two={[
              ["dial", "quick", "streak", "previsto", "insights", "save"],
              ["recap", "next", "queue", "conference"],
            ]}
            three={[
              ["dial", "quick", "streak", "previsto"],
              ["insights", "save", "recap", "next"],
              ["queue", "conference"],
            ]}
          />
          <LaunchToast />
        </>
      );
    }}
  </WithProjection>
);
