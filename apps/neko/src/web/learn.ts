/**
 * What Neko teaches, in its own words: one tip per screen the first time it has data, and the
 * full list in Ajustes › Como funciona. The Android app (ui/Learn.kt) says the same, word for word.
 */
export const HINTS = {
  hoje: "O arco é a fatura aberta perto do plano do ciclo.",
  hojeMes: "O arco é o gasto do mês perto do Diário previsto.",
  faturas: "Compra no cartão entra na planilha uma vez só: na fatura, no dia em que ela vence.",
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
  rule: "Conta os dias em que a planilha mudou. Uma folga por semana não quebra a sequência.",
  milestones: {
    7: "Uma semana inteira com a planilha em dia.",
    21: "Três semanas: lançar já faz parte do seu dia.",
    66: "66 dias é o tempo médio para um hábito se firmar.",
    100: "Cem dias de planilha em dia.",
    200: "Duzentos dias: o método virou rotina.",
    365: "Um ano inteiro de planilha em dia.",
  } as Record<number, string>,
} as const;

export const streakLabel = (streak: number) =>
  streak === 0 ? "Comece hoje" : `Planilha em dia · ${streak} ${streak === 1 ? "dia" : "dias"}`;

/** Mês's reserve panel, in the same words on the site and the app (ui/Learn.kt). */
export const RESERVE = {
  title: "Reserva de emergência",
  rule: "O método pede de 6 a 12 meses do custo de vida, guardados onde dá para sacar na hora.",
  empty: "Só contam como guardado as linhas de Saída sob o título Reserva nas notas.",
} as const;

/** Tenths of a month as "1,6 mês" or "2 meses". */
export const coveredLabel = (tenths: number) => {
  const n = tenths / 10;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
  return `${s} ${n >= 2 ? "meses" : "mês"}`;
};

export const costLabel = (months: number) =>
  months === 1 ? "Custo de vida do último mês" : `Custo de vida, média de ${months} meses`;
