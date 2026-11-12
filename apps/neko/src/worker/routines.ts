import { addDays, type LocalDate, weekday } from "@neko/engine";
import type { Mia2Line, Mia2Rotina } from "../shared/types.ts";
import { type Mia2Setup, runTurn, type TurnDeps } from "./mia2.ts";
import type { Reminder } from "./push.ts";

/**
 * Mia's routines (specs/004-mia, part 3): on Sunday she sums up the week, and on the 1st she closes
 * the month that ended, by herself, after the banks are read at 06:00. Her answer waits on the Mia
 * screen as the start of a conversation the owner can go on with, and the phone is told. She only
 * reads here: a routine never proposes an entry.
 */
export type RoutineKind = Mia2Rotina["tipo"];

/** The 1st closes the month (and takes the place of a Sunday that falls on it). */
export const routineFor = (today: LocalDate): RoutineKind | null =>
  today.endsWith("-01") ? "mes" : weekday(today) === 0 ? "semana" : null;

// No digits in what she is asked: the Neko takes the numbers of a question as checked (grounding.ts).
const ASIDE =
  "O dono não está na conversa agora: vai ler depois, no celular, e pode continuar dali. Não proponha lançamentos.";

export const ROUTINE_PROMPT: Record<RoutineKind, string> = {
  semana: `Rotina de domingo do Neko. ${ASIDE} Faça o resumo da semana que terminou ontem: uma frase curta com o que cartões e Pix levaram na semana, em negrito, e como foi contra a semana anterior; e o quadro de números com dois valores: quanto ainda cabe no teto do mês e a próxima conta ou fatura a vencer, com o dia na nota. Use as ferramentas semana, hoje e faturas.`,
  mes: `Rotina do primeiro dia do mês do Neko. ${ASIDE} Feche o mês passado (a ferramenta periodo diz qual é): uma frase curta que comece pelo resultado do mês, em negrito, e diga a parte das entradas que foi guardada e, se ficou abaixo, a meta do método, de vinte a trinta por cento; o quadro de números com dois valores, sem notas: o guardado e o diário médio; e um gráfico de barras do guardado nos seis últimos meses, até o mês passado. Use as ferramentas periodo, mes e resumo_meses.`,
};

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** The month a routine of the 1st closes: the one before `today`'s. */
const closedMonth = (today: string) => {
  const m = Number(today.slice(5, 7));
  return MONTHS[(m + 10) % 12] ?? "";
};

/** `8 nov`, as the screens write a day. */
const day = (d: LocalDate) =>
  `${Number(d.slice(8, 10))} ${(MONTHS[Number(d.slice(5, 7)) - 1] ?? "").slice(0, 3)}`;

/** Sunday's week, the seven days before it: "8 a 14 nov", or "29 nov a 5 dez" across months. */
const weekOf = (today: LocalDate) => {
  const from = addDays(today, -7);
  const to = addDays(today, -1);
  return from.slice(5, 7) === to.slice(5, 7)
    ? `${Number(from.slice(8, 10))} a ${day(to)}`
    : `${day(from)} a ${day(to)}`;
};

/** What stands where a question would, saying which week or month it is. */
export const routineTitle = (kind: RoutineKind, today: LocalDate): string =>
  kind === "semana" ? `Semana de ${weekOf(today)}` : `Fechamento de ${closedMonth(today)}`;

type Kept = Mia2Rotina["partes"][number];

/**
 * Takes her lines as the phone would: a redone answer replaces what came before it, a message
 * replaces its own partial text, and only an answer that ended well is kept.
 */
export const keeper = () => {
  let parts: Kept[] = [];
  let sessao: string | null = null;
  let ended = false;
  const write = (l: Mia2Line) => {
    if (l.t === "sessao") sessao = l.id;
    else if (l.t === "refazendo") parts = [];
    else if (l.t === "mensagem") {
      const at = parts.findIndex((p) => p.t === "mensagem" && p.id === l.id);
      parts = at < 0 ? [...parts, l] : parts.map((p, i) => (i === at ? l : p));
    } else if (l.t === "grafico" || l.t === "numeros") parts = [...parts, l];
    else if (l.t === "fim") ended = true;
  };
  const done = (kind: RoutineKind, today: LocalDate): Mia2Rotina | null =>
    ended && sessao && parts.some((p) => p.t === "mensagem")
      ? {
          id: `${kind}:${today}`,
          tipo: kind,
          titulo: routineTitle(kind, today),
          dia: today,
          sessao,
          partes: parts,
        }
      : null;
  return { write, done };
};

/** The notification: who did what, and her first sentence, plain. */
export const routineReminder = (r: Mia2Rotina): Reminder => {
  const first = r.partes.find((p) => p.t === "mensagem");
  const line =
    first?.t === "mensagem"
      ? (first.texto
          .split("\n")
          .map((s) =>
            s
              .replace(/\*\*/g, "")
              .replace(/^\s*(?:[-*•]|\d+\.)\s+/, "")
              .trim(),
          )
          .find(Boolean) ?? "")
      : "";
  return {
    title:
      r.tipo === "semana" ? "A Mia fez o resumo da semana" : `A Mia fechou ${closedMonth(r.dia)}`,
    body: line.length > 160 ? `${line.slice(0, 159).trimEnd()}…` : line,
    url: MIA,
    tag: "mia",
  };
};

/** The Mia screen: the web's route, and the Android app's own action. */
export const MIA = "/mia";

const KEY = "mia_rotina";
/** A routine shows until the next one; past this, it is old news. */
const KEEP_DAYS = 7;

export const saveRoutine = async (db: D1Database, r: Mia2Rotina): Promise<void> => {
  await db
    .prepare(
      "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .bind(KEY, JSON.stringify(r))
    .run();
};

/** Her latest routine, while it is news; null before the first or once a week has gone by. */
export const loadRoutine = async (db: D1Database, today: LocalDate): Promise<Mia2Rotina | null> => {
  const row = await db
    .prepare("SELECT value FROM setting WHERE key = ?")
    .bind(KEY)
    .first<{ value: string }>();
  if (!row) return null;
  const r = JSON.parse(row.value) as Mia2Rotina;
  const age = (Date.parse(today) - Date.parse(r.dia)) / 86_400_000;
  return age >= 0 && age < KEEP_DAYS ? r : null;
};

export interface RoutineDeps extends Omit<TurnDeps, "write"> {
  readonly setup: Mia2Setup;
  /** Tells the phone (and the browsers) once her answer is kept. */
  readonly notify: (r: Mia2Rotina) => Promise<void>;
}

/**
 * Today's routine, if today has one: she answers in a new conversation, which is kept for the Mia
 * screen and announced. One that fails or runs out of money leaves nothing behind.
 */
export const runRoutine = async (deps: RoutineDeps): Promise<Mia2Rotina | null> => {
  const kind = routineFor(deps.today);
  if (!kind) return null;
  const kept = keeper();
  await runTurn({ ...deps, write: kept.write }, deps.setup, { pergunta: ROUTINE_PROMPT[kind] });
  const r = kept.done(kind, deps.today);
  if (!r) return null;
  await saveRoutine(deps.db, r);
  await deps.notify(r);
  return r;
};
