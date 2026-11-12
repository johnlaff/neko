-- The text of the bank apps' notices that speak of a purchase or a card (specs/002, Compras na
-- hora), word for word, so the phone's reading can be checked against how each bank really words
-- them. Only Bradesco, Itaú, Inter and Mercado Pago, only notices with an amount in reais, never
-- Pix. Kept 15 days. `id` comes from the phone, so the same notice is kept once.
CREATE TABLE bank_notice (
  id TEXT PRIMARY KEY,
  app TEXT NOT NULL,
  bank TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  at TEXT NOT NULL,
  read INTEGER NOT NULL
);
