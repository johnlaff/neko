-- Open Finance through Meu Pluggy, read-only (specs/003-open-finance). The bank never changes a
-- balance or a bill: these rows only feed "Conferir" and "parcelas já compradas". Only the fields
-- a screen uses are kept, never the raw payload.

-- One row per bank the owner linked in Meu Pluggy; the id is typed in Ajustes, since Meu Pluggy
-- has no way to list them.
CREATE TABLE bank_item (
  item_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  synced_at TEXT,
  error TEXT
);

CREATE TABLE bank_account (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES bank_item (item_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  subtype TEXT,
  name TEXT NOT NULL,
  number TEXT,
  balance INTEGER NOT NULL,
  credit_limit INTEGER,
  available_limit INTEGER,
  close_date TEXT,
  due_date TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Amounts in cents with the provider's sign and type; dates are civil dates in São Paulo.
-- installment/installments/bill_month come from the card metadata (null on bank accounts).
CREATE TABLE bank_txn (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES bank_account (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  purchase_date TEXT,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  status TEXT,
  description TEXT NOT NULL,
  provider_id TEXT,
  installment INTEGER,
  installments INTEGER,
  bill_id TEXT,
  bill_month TEXT,
  card_number TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX bank_txn_account_date ON bank_txn (account_id, date);

CREATE TABLE bank_bill (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES bank_account (id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  close_date TEXT,
  total INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
