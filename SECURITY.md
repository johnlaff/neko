# Security

Neko handles one person's finances: a Google Sheet, bank data through Open Finance, and e-mailed
bills. This repository is public, so it must never hold that data or the keys to it.

## Reporting a problem

Please report a vulnerability privately through GitHub (Security › Report a vulnerability),
not in a public issue. Include what you found and how to reproduce it.

## How it is protected

- **Sign-in**: passkeys (WebAuthn), created from a one-time invite, for allowlisted e-mails.
  Sessions live in D1 and expire; every token (session, invite) is stored only as its SHA-256.
  Sign-in routes are rate limited.
- **API**: every route that reads or changes data needs a session cookie (`__Host-`, HttpOnly).
  Strict security headers, a same-origin check on posts, `Cache-Control: no-store`, Zod on every
  body. Machine routes use their own secrets: the Pluggy webhook (shared header), Mia's MCP
  endpoint and the statement inbox (bearer tokens compared in constant time).
- **The sheet**: read with a Viewer account; written only on the owner's tap by a separate Editor
  account that protected ranges keep away from balances, headers and other tabs. Every write is
  journaled, checked after writing and rolled back on any mismatch.
- **Banks**: read-only through Meu Pluggy. Webhooks carry no trusted data; the Worker fetches
  from the API itself.
- **E-mail**: `fatura@` keeps mail only from the owner's forwarding and known sender domains,
  checked on the envelope and the `From` header (Cloudflare rejects mail that fails DMARC).
- **Mia**: her tools read; the only other one leaves an entry in Para lançar for the owner to
  approve. Spending has a monthly cap.
- **Android**: the session and cached screens are encrypted with an Android Keystore key and kept
  out of backups; an optional app lock asks for a strong biometric or the device credential. The
  upload key never enters Git or CI logs.
- **Secrets**: the sheet id, allowed e-mails, service account keys, API keys, PDF passwords and
  biller domains are Worker or GitHub Actions secrets (list in `docs/operations.md`). Test data
  and screenshots are invented.
