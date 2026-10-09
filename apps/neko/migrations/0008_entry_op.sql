-- Entries written to the sheet (specs/005-lancamentos): one row per cell an entry changes. The row
-- is written before the cell, so a crash in the middle leaves a trace to reconcile, and keeps the
-- cell as it was, so the entry can be undone. `entry_id` is the idempotency key sent by the app:
-- the same entry sent twice writes once.
CREATE TABLE entry_op (
  entry_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('writing', 'done', 'failed', 'undone')),
  tab TEXT NOT NULL,
  cell TEXT NOT NULL,
  date TEXT NOT NULL,
  column_name TEXT NOT NULL,
  section TEXT,
  target TEXT NOT NULL,
  amount INTEGER NOT NULL,
  description TEXT NOT NULL,
  -- The cell's userEnteredValue as JSON (`{}` for an empty cell) and its note, before and after.
  before_value TEXT NOT NULL,
  before_note TEXT NOT NULL,
  after_formula TEXT NOT NULL,
  after_note TEXT NOT NULL,
  before_total INTEGER NOT NULL,
  after_total INTEGER NOT NULL,
  error TEXT,
  PRIMARY KEY (entry_id, part)
);

CREATE INDEX entry_op_state ON entry_op (state);
