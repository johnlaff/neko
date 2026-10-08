import type { Win } from "@neko/engine";

/** A month's win in words, for the recap panel and the push of the 1st (Android: Copy.win). */
export const winText = (w: Win) => {
  if (w.kind === "blue")
    return w.months === 1 ? "Mês no azul" : `${w.months} meses seguidos no azul`;
  if (w.kind === "kept") return "Bateu a meta de guardar 20% das entradas";
  if (w.kind === "cards-down") return "Faturas do cartão menores que as do mês anterior";
  if (w.kind === "record") return `Recorde: guardou ${w.share}% das entradas, o maior até aqui`;
  return `A reserva já cobre ${w.months === 1 ? "1 mês" : `${w.months} meses`} de custo de vida`;
};

/**
 * A win as the shared picture says it: the same words, minus the share of the income kept,
 * since what is shared is the achievement, not the finances (Android: Copy.winShare).
 */
export const winShareText = (w: Win) =>
  w.kind === "record" ? "Recorde: o mês que mais guardou até aqui" : winText(w);
