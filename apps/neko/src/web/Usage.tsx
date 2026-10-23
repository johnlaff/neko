import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import type { UsageCount } from "../shared/usage.ts";
import { api } from "./api.ts";
import { days } from "./format.ts";
import { IconChevron } from "./icons.tsx";

const times = (n: number) => (n === 0 ? "Nunca" : n === 1 ? "1 vez" : `${n} vezes`);

const Counts = ({ title, items }: { title: string; items: readonly UsageCount[] }) => (
  <>
    <h3>{title}</h3>
    <dl className="ledger">
      {items.map((e) => (
        <Fragment key={e.event}>
          <dt>{e.label}</dt>
          <dd className={e.count === 0 ? "muted" : undefined}>{times(e.count)}</dd>
        </Fragment>
      ))}
    </dl>
  </>
);

/**
 * Ajustes › Uso do Neko: what was opened in the last 30 days, counted on Neko's own server (the
 * Worker's usage.ts), so what to keep or cut is decided with data. Folded: one line until asked.
 */
export const Usage = () => {
  const usage = useQuery({ queryKey: ["usage"], queryFn: api.usage });
  const s = usage.data;
  // Parsed at the boundary: an older Worker answers without it, and the group just stays out.
  if (!s || !Array.isArray(s.screens) || !Array.isArray(s.taps)) return null;
  return (
    <section className="group" aria-labelledby="g-usage">
      <h2 id="g-usage">Uso do Neko</h2>
      <div className="panel list usage">
        <details className="formula">
          <summary>
            <IconChevron />
            {s.days === 0
              ? `Sem uso nos últimos ${s.window} dias`
              : `Aberto em ${s.days} dos últimos ${s.window} dias`}
          </summary>
          <h3>Onde</h3>
          <dl className="ledger">
            <dt>No app Android</dt>
            <dd>{days(s.android)}</dd>
            <dt>No site</dt>
            <dd>{days(s.web)}</dd>
          </dl>
          <Counts title="Telas" items={s.screens} />
          <Counts title="Botões" items={s.taps} />
          <p>Só contagens de telas e botões, no servidor do Neko. Nenhum valor da planilha.</p>
        </details>
      </div>
    </section>
  );
};
