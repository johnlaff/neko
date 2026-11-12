-- Card purchases the Android app read from the bank app's notification (specs/002, item 11):
-- they move the month's ceiling at once, until Open Finance brings the same charge. Never a line
-- of the sheet. Kept 15 days. `id` comes from the phone, so the same notification is kept once.
CREATE TABLE phone_purchase (
  id TEXT PRIMARY KEY,
  bank TEXT NOT NULL,
  amount INTEGER NOT NULL,
  last4 TEXT,
  merchant TEXT NOT NULL,
  at TEXT NOT NULL
);
