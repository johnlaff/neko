import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { MiaNote } from "../shared/types.ts";
import { api, type ProjectionResponse, used } from "./api.ts";
import { BrandMark } from "./BrandMark.tsx";
import { IconClose } from "./icons.tsx";

/**
 * Mia's line on top of Hoje (specs/004-mia, "A linha da Mia em Hoje"): what the daily watch found,
 * or her routine, in one sentence the Worker wrote from the rules' own numbers. A tap asks her about
 * it, or opens Faturas without her; the cross sets it aside. Either way it does not come back, on
 * any device.
 */

/** The question the line hands to her screen, asked once as it opens. */
let queued: string | null = null;

/** Her screen takes the question the line left, if any, once. */
export const takeQueued = (): string | null => {
  const q = queued;
  queued = null;
  return q;
};

/** Gone here at once, and on the other devices once the Worker has it. */
export const noteSeen = (queryClient: QueryClient, id: string) => {
  queryClient.setQueryData<ProjectionResponse>(["projection"], (d) =>
    d?.nota?.id === id ? { ...d, nota: null } : d,
  );
  void api.seeNote(id).catch(() => undefined);
};

export const MiaLine = ({ nota, onGone }: { nota: MiaNote; onGone: () => void }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const open = () => {
    used("nota");
    noteSeen(queryClient, nota.id);
    if (nota.abre === "faturas") return void navigate({ to: "/faturas" });
    queued = nota.pergunta;
    void navigate({ to: "/mia" });
  };
  return (
    <aside className="mia-line" aria-label="Mia">
      <button type="button" className="mia-line-open" onClick={open}>
        <BrandMark width={28} className="mia-mark" />
        <span className="mia-line-text">
          <span className="mia-line-title">{nota.titulo}</span>
          <span>{nota.texto}</span>
          <span className="sr-only">
            {nota.abre === "faturas" ? ", abre Faturas" : ", pergunte à Mia"}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="icon mia-line-close"
        aria-label="Dispensar"
        title="Dispensar"
        onClick={() => {
          noteSeen(queryClient, nota.id);
          onGone();
        }}
      >
        <IconClose />
      </button>
    </aside>
  );
};
