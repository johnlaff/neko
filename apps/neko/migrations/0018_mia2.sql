-- Mia 2 (specs/004-mia): the Anthropic objects the Worker made for her (environment, memory, vault,
-- agent and its version), by name, so each is made once.
CREATE TABLE mia2_setup (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Her conversations: the id at Anthropic and what each has cost so far, in US cents, so only the
-- difference is booked in mia_usage. Nothing of what was said is kept here.
CREATE TABLE mia2_session (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  cost_cents INTEGER NOT NULL DEFAULT 0
);
