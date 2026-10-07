-- Reminders belong to the signed-in device that asked for them: signing a device out (or letting
-- its session expire) stops its notifications too. Rows from before this column stay NULL until
-- the app re-sends its subscription on the next visit.
ALTER TABLE push_subscription ADD COLUMN session_id_hash TEXT;

-- WebAuthn challenges kept on the server, so each one can be used once: the cookie only names
-- the row, and verifying deletes it.
CREATE TABLE webauthn_challenge (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
