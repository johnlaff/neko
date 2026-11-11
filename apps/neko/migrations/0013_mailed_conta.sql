-- A bill e-mailed by a biller the owner set in BILL_SENDERS (light, phone; inbox.ts): its value and
-- due day, known before it is paid, for Para lançar to correct the line the sheet plans for it. One
-- per biller and due date; a later e-mail for the same bill replaces it.
CREATE TABLE mailed_conta (
  -- The biller as its e-mail's domain names it.
  biller TEXT NOT NULL,
  due_date TEXT NOT NULL,
  -- Cents.
  total INTEGER NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (biller, due_date)
);
