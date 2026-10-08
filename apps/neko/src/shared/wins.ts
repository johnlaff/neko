import type { Win } from "@neko/engine";

/** A month's win in words, for the recap panel and the push of the 1st (Android: Copy.win). */
export const winText = (w: Win) => {
  if (w.kind === "blue")
    return w.months === 1 ? "Mês no azul" : `${w.months} meses seguidos no azul`;
  if (w.kind === "kept") return "Bateu a meta de guardar 20% das entradas";
  return `A reserva já cobre ${w.months === 1 ? "1 mês" : `${w.months} meses`} de custo de vida`;
};
