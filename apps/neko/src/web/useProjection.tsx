import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiError, api, type ProjectionResponse } from "./api.ts";
import { BrandMark } from "./BrandMark.tsx";

export const useProjection = () => useQuery({ queryKey: ["projection"], queryFn: api.projection });

/** Placeholder with the shape of the screen, so the layout does not jump when data lands. */
export const Skeleton = () => (
  <div className="skeleton" aria-busy="true">
    <span className="sr-only">Carregando</span>
    <div className="panel">
      <i className="line short" />
      <i className="arc" />
      <div className="sk-row">
        <i className="line" />
        <i className="line" />
        <i className="line" />
      </div>
    </div>
    <div className="sk-row">
      <i className="pill" />
      <i className="pill" />
    </div>
    <div className="panel">
      <i className="line short" />
      {[0, 1, 2, 3].map((n) => (
        <div key={n} className="sk-item">
          <i className="dot" />
          <i className="line" />
        </div>
      ))}
    </div>
  </div>
);

export const ErrorBlock = ({
  title,
  text,
  retry,
  busy = false,
}: {
  title: string;
  text: string;
  retry: () => void;
  busy?: boolean;
}) => (
  <section className="panel state" role="alert">
    <BrandMark width={64} className="quiet-mark" />
    <h2>{title}</h2>
    <p className="muted">{text}</p>
    <button type="button" className="ghost" onClick={retry} disabled={busy}>
      {busy ? "Tentando…" : "Tentar de novo"}
    </button>
  </section>
);

/** Loading and error states shared by every screen, so each screen only renders data. */
export const WithProjection = ({
  children,
}: {
  children: (data: ProjectionResponse & { offline?: true }) => ReactNode;
}) => {
  const q = useProjection();
  if (q.isPending) return <Skeleton />;
  if (q.isError) {
    const structure = q.error instanceof ApiError && q.error.code === "sheet-structure";
    return (
      <ErrorBlock
        title={structure ? "A planilha mudou de formato" : "Não consegui ler a planilha"}
        text={
          structure
            ? `${q.error.message} Fora do formato esperado, nada foi calculado.`
            : "Pode ser a conexão ou o Google fora do ar. A planilha não foi alterada."
        }
        retry={() => q.refetch()}
        busy={q.isFetching}
      />
    );
  }
  return <>{children(q.data)}</>;
};
