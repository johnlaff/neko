/**
 * Banks and card issuers the app recognises by a card's name in the sheet, to show the issuer's
 * official mark instead of two letters. Each mark is the issuer's own vector artwork in one colour
 * (web/bankMarks.ts, Android res/drawable/bank_*.xml), shown only to tell the owner's own cards
 * apart. `bg`/`fg` are the brand colours of its tile. Order matters: the first match wins, and
 * Amazon comes first because its card is issued by Bradescard.
 */
export const INSTITUTIONS = [
  { slug: "amazon", name: "Amazon", words: ["amazon"], bg: "#232F3E", fg: "#FF9900" },
  { slug: "itau", name: "Itaú", words: ["itau", "itaucard"], bg: "#FF6200", fg: "#FFFFFF" },
  { slug: "bradesco", name: "Bradesco", words: ["bradesco"], bg: "#CC092F", fg: "#FFFFFF" },
  {
    slug: "inter",
    name: "Banco Inter",
    words: ["inter", "banco inter"],
    bg: "#EA7100",
    fg: "#FFFFFF",
  },
  { slug: "nubank", name: "Nubank", words: ["nubank", "nu"], bg: "#820AD1", fg: "#FFFFFF" },
  {
    slug: "mercadopago",
    name: "Mercado Pago",
    words: ["mercado pago", "mercadopago"],
    bg: "#00BCFF",
    fg: "#0A0080",
  },
  {
    slug: "bancodobrasil",
    name: "Banco do Brasil",
    words: ["banco do brasil", "bb", "ourocard"],
    bg: "#FCFC30",
    fg: "#465EFF",
  },
  { slug: "sicoob", name: "Sicoob", words: ["sicoob", "sicoobcard"], bg: "#003641", fg: "#C9D200" },
  { slug: "santander", name: "Santander", words: ["santander"], bg: "#EC0000", fg: "#FFFFFF" },
  { slug: "caixa", name: "Caixa", words: ["caixa", "cef"], bg: "#005CA9", fg: "#FFFFFF" },
  {
    slug: "c6bank",
    name: "C6 Bank",
    words: ["c6", "c6 bank", "c6bank"],
    bg: "#242424",
    fg: "#FFFFFF",
  },
  { slug: "picpay", name: "PicPay", words: ["picpay"], bg: "#21C25E", fg: "#FFFFFF" },
  {
    slug: "xp",
    name: "XP Investimentos",
    words: ["xp", "xp investimentos"],
    bg: "#000000",
    fg: "#FFFFFF",
  },
] as const;

export type Institution = (typeof INSTITUTIONS)[number];

/** Lowercase words without accents: "Itaú Personnalité" → " itau personnalite ". */
const words = (s: string) =>
  ` ${s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

/** The issuer a card's name points to, by whole words only ("Inter" yes, "Internet" no). */
export const institutionOf = (name: string): Institution | null => {
  const w = words(name);
  return INSTITUTIONS.find((i) => i.words.some((word) => w.includes(` ${word} `))) ?? null;
};
