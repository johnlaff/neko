# Neko Finance v2

Web app (and, in Phase 2, native Android) that **reads** João's Google Sheet and turns it into
"pode gastar hoje", projected card bills, sheet health checks and the month's outlook. Neko never
writes to the sheet: its Google service account is a Viewer and asks only for read scopes.

Live: https://neko.joaoaraxaiba.workers.dev (Google sign-in, allowlisted e-mails only).

## Layout

| Path | Role | Rule |
|---|---|---|
| `packages/engine` | Money in cents, civil dates, card cycles, balance chain, projection, health checks | Pure functions; "today" is a parameter. Every finance rule is tested here |
| `packages/sheet-reader` | Sheets API grid → validated ledger; note grammar; "previsão do diário" note | The only door into the sheet. Stops on an unexpected structure instead of guessing |
| `apps/neko` | One Cloudflare Worker: Hono API under `/api`, React SPA as static assets, D1 cache | Orchestrates only: read → ledger → engine → cache/serve |

Pipeline: Drive file version (one cheap call) → if changed, `spreadsheets.get` with a field mask
for the year tabs → `readSpreadsheet` → `project` → stored in D1 per (file version, today,
settings). A daily cron at 05:00 São Paulo warms the cache and records the forecast history.

## Commands

```sh
pnpm install
pnpm check          # lint + typecheck + tests
pnpm dev            # Vite + Worker locally (needs apps/neko/.dev.vars, see below)
pnpm deploy         # build and deploy the Worker
```

`apps/neko/.dev.vars` (gitignored) holds `GOOGLE_SERVICE_ACCOUNT_JSON` and `SESSION_SECRET` for
local runs. In production they are Worker secrets (`wrangler secret put`).

## Configuration

- `wrangler.jsonc` vars: `SHEET_ID`, `ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID` (OAuth web client for
  Google sign-in; login stays disabled while empty).
- User settings live in D1 and are edited in the app (Ajustes): diário per day, usual card, cycle
  budget, each card's closing day, cards paid by someone else.
- CI deploys on merge to `main` once the repo has the `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` Actions secrets. It never applies D1 migrations: those run by hand
  (`pnpm --filter @neko/app db:migrate:remote`), with the owner's OK, before the PR that needs
  them merges.

See `specs/001-fase-1/spec.md` for the Phase 1 scope and decisions.
