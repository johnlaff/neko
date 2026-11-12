import type { ReserveStep, ReserveSteps, SavingStep } from "@neko/engine";
import type { DailySource } from "../shared/types.ts";
import { roundMoney } from "./format.ts";

/**
 * What Neko teaches, in its own words: one tip per screen the first time it has data, and the
 * full list in Ajustes › Como funciona. The Android app (ui/Learn.kt) says the same, word for word.
 */
export const HINTS = {
  hoje: "O arco enche com a fatura aberta. O ponto é o ritmo de hoje.",
  hojeMes: "O arco enche com o gasto do mês. O ponto é o previsto até ontem.",
  hojeCartoes: "O arco é o quanto os cartões e o Pix do mês já ocupam do teto.",
  faturas: "Compra no cartão entra na planilha só uma vez: na fatura, no vencimento.",
  mes: "O saldo de cada dia vem da planilha. Com o gasto dos dias à frente previsto, ele fica realista.",
} as const;

/** Opens Ajustes › Como funciona. */
export const LEARN_INTRO = "Todas as dicas do app, num lugar só.";

/** Where cards come from, when the sheet has none: Hoje and Faturas say it the same way. */
export const CARDS_COME_FROM = "Os cartões vêm das notas de Saída, abaixo da linha CARTÕES.";

export const IDEAS: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: "De onde vêm os números",
    body: "Tudo vem da sua planilha. O Neko lê e faz as contas, e só escreve nela quando você toca em Lançar.",
  },
  {
    title: "Saída ou diário",
    body: "Conta com data e valor certos vai em Saída. O gasto do dia a dia é diário. No cartão, a compra entra só na fatura, no dia do vencimento.",
  },
  {
    title: "Os dias à frente",
    body: "Deixe previsto o gasto de cada dia futuro e troque pelo real quando o dia passar. Sem isso, o saldo de lá parece maior.",
  },
  {
    title: "O dia mais baixo",
    body: "Olhe o menor saldo daqui para frente. Se ficar abaixo de zero, você já sabe quando e quanto vai faltar.",
  },
  {
    title: "Guardar primeiro",
    body: "No dia em que o dinheiro entra, separe o que der. O saldo cai, e tudo bem: mire guardar de 20% a 30% das entradas.",
  },
  {
    title: "Reserva",
    body: "Antes de investir, junte de 6 a 12 meses do seu custo de vida.",
  },
];

/** Hoje's streak, in the same words on the site and the app (ui/Learn.kt). */
export const HABIT = {
  rule: "Conta os dias em que a planilha mudou. Um dia sem lançar não quebra a sequência se você lançar no dia seguinte.",
  /** Yesterday went without a change: today's edit is what keeps the run. */
  atRisk: "Lance hoje para continuar",
  /** Today's edit mended yesterday. */
  mended: "Ontem recuperado",
  /** Each day's mark, as the screen reader says it; the legend shows the first three. */
  days: {
    edited: "lançado",
    rest: "recuperado",
    missed: "sem lançar",
    today: "hoje, em aberto",
    future: "ainda não chegou",
  },
  milestones: {
    7: "Uma semana inteira com a planilha em dia.",
    21: "Três semanas: lançar já faz parte do seu dia.",
    66: "66 dias é o tempo médio para um hábito se firmar.",
    100: "Cem dias de planilha em dia.",
    200: "Duzentos dias: o método virou rotina.",
    365: "Um ano inteiro de planilha em dia.",
  } as Record<number, string>,
} as const;

/** The run in words; while yesterday waits to be mended the sheet is not "em dia", only the run. */
export const streakLabel = (streak: number, atRisk = false) =>
  streak === 0
    ? "Comece hoje"
    : `${atRisk ? "Sequência de" : "Planilha em dia ·"} ${streak} ${streak === 1 ? "dia" : "dias"}`;

/**
 * Mês's totals, the method's (app do Breno, aula 4): what was kept against the 20% to 30% goal
 * and what a day really cost. Same words on the site and the app (ui/Learn.kt).
 */
export const TOTALS = {
  saved: "Guardado",
  /** The month still has Reserva lines ahead of today. */
  toSave: "A guardar",
  // "20% a 30%" never breaks across lines.
  goal: "Meta de 20%\u00a0a\u00a030% das entradas",
  daily: "Diário médio",
  dailyCaption: "Diário e faturas do mês, por dia",
  cost: "Custo de vida",
  costNote:
    "Custo de vida é o que saiu sem contar o que foi guardado. A reserva de emergência do método cobre de 6 a 12 meses desse custo.",
} as const;

/** Under Ver extrato, why a month that kept money can show the balance going down. */
export const resultNote = (down: boolean) =>
  `O saldo ${down ? "desceu" : "subiu"} é a diferença entre o começo e o fim do mês, e o que foi guardado também sai da conta.`;

/** Where the diário in use comes from, after its value. */
export const dailySourceText = (source: DailySource) =>
  source === "settings"
    ? "seu ajuste"
    : source === "sheet-note"
      ? "da nota na planilha"
      : "média dos últimos 3 meses";

/** Mês's reserve panel, in the same words on the site and the app (ui/Learn.kt). */
export const RESERVE = {
  title: "Reserva de emergência",
  rule: "O método pede de 6 a 12 meses, guardados onde dá para sacar na hora.",
  empty: "Para contar aqui, lance o valor como Saída sob o título Reserva, nas notas.",
  nothing: "Nada guardado ainda",
  done: "Reserva completa",
  minimum: "Já tem os 6 meses que o método pede",
} as const;

/** A goal's distance in whole reais, rounded up: the goal is a multiple of an average. */
const upToReal = (cents: number) => roundMoney(Math.ceil(cents / 100) * 100);

const months = (n: number) => `${n} ${n === 1 ? "mês" : "meses"} de custo de vida`;

/** A step as a goal: "os primeiros R$ 3.000" or "3 meses de custo de vida". */
export const stepGoal = (s: ReserveStep) =>
  s.months === null ? `os primeiros ${roundMoney(s.amount)}` : months(s.months);

/** Over the meter: which step is being climbed, out of all of them. */
export const stepsMeta = (s: ReserveSteps, kept: number) =>
  !s.next
    ? RESERVE.done
    : kept > 0
      ? `Degrau ${s.reached + 1} de ${s.steps.length}`
      : RESERVE.nothing;

/** True once the method's minimum of 6 months is kept: from there on 12 is his call. */
const minimumKept = (s: ReserveSteps) => s.steps[s.reached - 1]?.months === 6;

/** Under the meter, in bold: how far the next step is. */
export const stepLine = (s: ReserveSteps, kept: number) => {
  const last = s.steps.at(-1);
  if (!s.next) return `Já passou de ${last ? stepGoal(last) : ""}`;
  if (minimumKept(s)) return RESERVE.minimum;
  if (kept > 0) return `Faltam ${upToReal(s.missing)} para ${stepGoal(s.next)}`;
  return `Primeiro degrau: ${s.next.months === null ? roundMoney(s.next.amount) : stepGoal(s.next)}`;
};

/** Under that, muted, when there is one: how to start, or what 12 months would still need. */
export const stepHint = (s: ReserveSteps, kept: number) =>
  kept <= 0
    ? RESERVE.empty
    : s.next && minimumKept(s)
      ? `Para 12 meses, faltam ${upToReal(s.missing)}.`
      : null;

/** The steps in one line, before the method's rule. */
export const stepsRule = (s: ReserveSteps) => {
  const n = s.steps.flatMap((x) => (x.months === null ? [] : [x.months]));
  const list = `${n.slice(0, -1).join(", ")} e ${n.at(-1)} meses de custo de vida`;
  const first = s.steps[0];
  return first?.months === null
    ? `Degraus: ${roundMoney(first.amount)}, depois ${list}.`
    : `Degraus: ${list}.`;
};

/** Hoje's payday card: what saving it all does to the reserve. */
export const saveStepText = (s: SavingStep) => {
  if (s.missing > 0) return `Com isso, faltam ${upToReal(s.missing)} para ${stepGoal(s.step)}`;
  if (s.step.months === null) return `Com isso, a reserva chega a ${roundMoney(s.step.amount)}`;
  if (s.step.months === 6) return "Com isso, a reserva chega a 6 meses, o mínimo do método";
  return `Com isso, a reserva chega a ${months(s.step.months)}`;
};

export const costLabel = (months: number) =>
  months === 1 ? "Custo de vida do último mês" : `Custo de vida, média de ${months} meses`;
