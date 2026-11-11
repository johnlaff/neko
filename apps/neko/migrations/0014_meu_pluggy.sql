-- When Meu Pluggy last read each bank (the item's lastUpdatedAt): how fresh its numbers are.
-- synced_at stays the time Neko read them from Pluggy, which the 06:00 cron moves every day even
-- when the bank itself has nothing newer.
ALTER TABLE bank_item ADD COLUMN bank_updated_at TEXT;

-- The owner's sign-in at meu.pluggy.ai, the only way to make a bank refresh now (meupluggy.ts).
-- One row. Both cookie sets are encrypted with a key derived from SESSION_SECRET.
CREATE TABLE meu_pluggy (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- The site's session cookies; null until the owner signs in, and again once they expire.
  session TEXT,
  -- When that session began: how long Meu Pluggy keeps one alive is learned from it.
  signed_in_at TEXT,
  -- A sign-in started and not finished: the cookies the e-mailed link must be opened with, and
  -- the state it must carry.
  pending TEXT,
  pending_state TEXT,
  pending_at TEXT
);
