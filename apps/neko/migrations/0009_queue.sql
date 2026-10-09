-- Para lançar (specs/005-lancamentos, Fase 2): what the owner decided about each item the bank
-- proposed, so a launched or ignored item does not come back. `entry_id` ties a launched item to
-- its entry in `entry_op`: undoing the entry brings the item back.
CREATE TABLE queue_decision (
  key TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('launched', 'ignored')),
  entry_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX queue_decision_entry ON queue_decision (entry_id);
