-- Passkeys (WebAuthn) that can sign in to Neko. The id is the credential id (base64url); the
-- public key is the COSE key, base64url too. The counter guards against cloned authenticators.
CREATE TABLE passkey (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

-- One-time links to create a passkey. Only the SHA-256 of the token is stored, so a copy of the
-- database cannot be turned into a working link.
CREATE TABLE passkey_invite (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
