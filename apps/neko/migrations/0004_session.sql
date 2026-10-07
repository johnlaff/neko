-- Signed-in devices. The cookie holds a random token; only its SHA-256 is stored, so a copy of
-- the database cannot sign anyone in. Deleting a row signs that device out on its next request.
CREATE TABLE session (
  id_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  device TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX session_email ON session (email);
