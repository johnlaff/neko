-- Mia's spending (specs/004-mia): one row per call to the Anthropic API, priced when it is made.
-- The monthly cap reads the sum for the month; nothing of the question or the answer is kept.
CREATE TABLE mia_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  month TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  micro_usd INTEGER NOT NULL
);

CREATE INDEX mia_usage_month ON mia_usage (month);
