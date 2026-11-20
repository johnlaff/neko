// Kept apart from the screen, so the router reads Faturas' address without loading the screen.

/**
 * What Faturas shows: the month (`m`), and a card's bill, a person, the review or every parcel
 * over it (`parcelas`, with `cartao` when opened from that card's bill).
 */
export interface FaturasSearch {
  m?: string;
  cartao?: string;
  pessoa?: string;
  revisar?: boolean;
  parcelas?: boolean;
}

export const faturasSearch = (s: Record<string, unknown>): FaturasSearch => {
  const text = (v: unknown) =>
    typeof v === "string" && v.length > 0 && v.length <= 80 ? v : undefined;
  const out: FaturasSearch = {};
  if (typeof s.m === "string" && /^\d{4}-\d{2}$/.test(s.m)) out.m = s.m;
  const cartao = text(s.cartao);
  if (cartao) out.cartao = cartao;
  const pessoa = text(s.pessoa);
  if (pessoa) out.pessoa = pessoa;
  if (s.revisar === true || s.revisar === "true") out.revisar = true;
  if (s.parcelas === true || s.parcelas === "true") out.parcelas = true;
  return out;
};
