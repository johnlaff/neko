-- A closed card bill whose total the bank writes in the e-mail itself, for a card outside Open
-- Finance (inbox.ts): the bill's total is all Neko keeps from it, one per card and due date; a
-- later e-mail for the same bill replaces it.
CREATE TABLE mailed_bill (
  -- The card as the e-mail names it, matched to the sheet's card by name.
  card TEXT NOT NULL,
  due_date TEXT NOT NULL,
  -- Cents.
  total INTEGER NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (card, due_date)
);
