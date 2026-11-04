-- The bank's own bill, read from the PDF the owner sends (specs/003-open-finance, "Fatura do
-- banco"): every line it prints, so the engine can add what Open Finance left out. One bill per
-- card account and due month; a newer read of the same bill replaces it.
CREATE TABLE statement (
  account_id TEXT NOT NULL,
  -- Due month, YYYY-MM.
  bill_month TEXT NOT NULL,
  -- 1 when the bank had closed it, 0 while it was still open.
  closed INTEGER NOT NULL,
  -- The whole bill as printed, in cents.
  total INTEGER NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (account_id, bill_month)
);

CREATE TABLE statement_line (
  account_id TEXT NOT NULL,
  bill_month TEXT NOT NULL,
  -- Its place on the bill, so two equal lines stay two.
  seq INTEGER NOT NULL,
  -- The card's last digits as printed: the sheet's card comes from Ajustes, when read.
  card_number TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  -- Cents: positive a charge, negative a credit.
  amount INTEGER NOT NULL,
  installment INTEGER,
  installments INTEGER,
  PRIMARY KEY (account_id, bill_month, seq),
  FOREIGN KEY (account_id, bill_month) REFERENCES statement (account_id, bill_month) ON DELETE CASCADE
);
