/** Integer amount of centavos. Never use floats for money outside the parse boundary. */
export type Cents = number & { readonly __brand: "Cents" };

export const cents = (n: number): Cents => {
  if (!Number.isSafeInteger(n)) throw new RangeError(`not an integer amount of cents: ${n}`);
  return n as Cents;
};

export const ZERO = cents(0);

/** Converts a spreadsheet number (reais, possibly with float noise) into cents. */
export const fromReais = (reais: number): Cents => cents(Math.round(reais * 100));

export const add = (...xs: Cents[]): Cents => cents(xs.reduce((a, b) => a + b, 0));
export const sub = (a: Cents, b: Cents): Cents => cents(a - b);
export const mul = (a: Cents, k: number): Cents => cents(Math.round(a * k));

/** Divides and rounds toward zero, so an allowance is never overstated by rounding. */
export const divFloor = (a: Cents, k: number): Cents => cents(Math.trunc(a / k));

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatBRL = (c: Cents): string => brl.format(c / 100);
