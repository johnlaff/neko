# Neko

Web app and native Android app that **read** a personal Google Sheet and turns it into
"pode gastar hoje", projected card bills, sheet health checks and the month's outlook. Neko never
writes to the sheet: its Google service account is a Viewer and asks only for read scopes.

Live: https://neko.joaoaraxaiba.workers.dev (Google sign-in, allowlisted e-mails only).

## Layout

| Path | Role | Rule |
|---|---|---|
| `packages/engine` | Money in cents, civil dates, card cycles, balance chain, projection, health checks | Pure functions; "today" is a parameter. Every finance rule is tested here |
| `packages/sheet-reader` | Sheets API grid → validated ledger; note grammar; "previsão do diário" note | The only door into the sheet. Stops on an unexpected structure instead of guessing |
| `apps/neko` | One Cloudflare Worker: Hono API under `/api`, React SPA as static assets, D1 cache | Orchestrates only: read → ledger → engine → cache/serve |
| `apps/android` | Kotlin + Compose app and Glance widget, a thin client of `/api/today` | Formats only; any derived figure comes from the API |

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

- Worker secrets: `SHEET_ID`, `ALLOWED_EMAILS`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `SESSION_SECRET`,
  `VAPID_PRIVATE_KEY`, and for Open Finance (optional) `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`,
  `PLUGGY_WEBHOOK_SECRET`. `wrangler.jsonc` vars hold only public values (`GOOGLE_CLIENT_ID`,
  `SENTRY_DSN`, `VAPID_PUBLIC_KEY`, the Android package and certificate fingerprints).
- User settings live in D1 and are edited in the app (Ajustes): diário per day, usual card, cycle
  budget, each card's closing day, cards paid by someone else.
- CI deploys on merge to `main` once the repo has the `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` Actions secrets. It never applies D1 migrations: those run by hand
  (`pnpm --filter @neko/app db:migrate:remote`) before the PR that needs them merges.

## Android

```sh
cd apps/android
./gradlew testDebugUnitTest lintDebug assembleRelease   # what CI runs
./gradlew recordRoborazziDebug                          # screenshots into app/screenshots
```

Needs JDK 21 and the Android SDK (`ANDROID_HOME`). Release builds are signed only when
`apps/android/signing.properties` (gitignored) points at the upload key, which never enters Git
or CI. The app signs in with the site's passkey: the Worker serves `/.well-known/assetlinks.json`
for the certificates in `ANDROID_CERT_SHA256`.

See `specs/001-fase-1/spec.md` and `specs/002-android/spec.md` for scope and decisions.
