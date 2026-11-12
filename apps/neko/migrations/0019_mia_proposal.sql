-- What Mia proposed in a conversation (Mia 2, part 3): an entry as the owner would type it by hand,
-- waiting in Para lançar like what the bank brings (engine `MiaProposal`). Nothing here reaches the
-- sheet: Lançar goes through /api/entries, and Lançar or Ignorar is kept in queue_decision.
CREATE TABLE mia_proposal (
  id TEXT PRIMARY KEY,
  -- engine `EntryInput` as JSON: kind, amount (cents), description, date, card, installments.
  entry TEXT NOT NULL,
  created_at TEXT NOT NULL
);
