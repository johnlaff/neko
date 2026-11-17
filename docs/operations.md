# Operations

How to run, configure, deploy and look after Neko. For what the code does, see
`ARCHITECTURE.md`; for why, see `specs/`.

## Local development

Needs Node 22+ and pnpm (the version is pinned in `package.json`). Android needs JDK 21 and the
Android SDK (`ANDROID_HOME`).

```sh
pnpm install
pnpm check                         # Biome, TypeScript and Vitest: what CI runs, minus the build
pnpm build                         # Vite build of the web app and the Worker
pnpm --filter @neko/app e2e        # Playwright smoke test of the built app, on invented data
pnpm dev                           # Vite + the Worker in workerd, with a local D1
```

`pnpm dev` reads `apps/neko/.dev.vars` (gitignored), with the same names as the Worker secrets
below; reading the sheet needs at least `SHEET_ID`, `ALLOWED_EMAILS`,
`GOOGLE_SERVICE_ACCOUNT_JSON` and `SESSION_SECRET`. Create the local database once with
`pnpm --filter @neko/app exec wrangler d1 migrations apply neko --local`.

Tests that need private data skip themselves without it:

- `NEKO_REAL_SHEET=<sheet.json> pnpm test` runs the real-sheet acceptance tests against a private
  copy of the owner's sheet, kept outside Git.
- `NEKO_TEST_SHEET_ID` plus `NEKO_WRITER_SERVICE_ACCOUNT_JSON` run the writer's contract tests
  against the "Neko Teste" sheet (invented data, same protections as the real one). CI runs them
  one at a time across branches.

Android:

```sh
cd apps/android
./gradlew testDebugUnitTest lintDebug assembleRelease          # what CI runs
./gradlew testDebugUnitTest -Proborazzi.test.record=true       # redraw app/screenshots
NEKO_REAL_SHEET=<sheet.json> ./real-prints.sh <out-dir>        # screens with real numbers, outside Git
```

## Configuration

### Worker secrets (`wrangler secret put <NAME>`)

| Secret | What it is | When absent |
|---|---|---|
| `SHEET_ID` | The spreadsheet id | Nothing works |
| `ALLOWED_EMAILS` | E-mails that may sign in, comma-separated | Nobody can sign in |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Key of the reader account (Viewer of the sheet) | Nothing works |
| `SESSION_SECRET` | Signs challenge cookies; also derives the key that encrypts the Meu Pluggy session | Sign-in fails |
| `VAPID_PRIVATE_KEY` | Web Push private key | No browser notifications |
| `NEKO_WRITER_SERVICE_ACCOUNT_JSON` | Key of the `neko-writer` account (Editor of the sheet) | Neko writes nothing; Lançar is hidden |
| `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` | Pluggy application keys (Meu Pluggy connector) | Open Finance is off |
| `PLUGGY_WEBHOOK_SECRET` | Header Pluggy sends back on every webhook | Webhooks are refused; the daily sync still runs |
| `ANTHROPIC_API_KEY` | Key of the Console workspace for Mia (monthly limit set there too) | Mia is hidden; PDF bills are not read |
| `MIA_MCP_TOKEN` | Random bearer token Mia 2's agent uses on `/api/mcp`; never derived from another secret | Mia 1 answers instead |
| `STATEMENT_INBOX_TOKEN` | Bearer token for `/api/inbox/statement` (a script sending PDF bills) | That route refuses everything |
| `STATEMENT_PDF_PASSWORDS` | Passwords banks lock e-mailed PDF bills with, comma-separated | Locked bills are not read |
| `BILL_SENDERS` | Domains of billers (light, phone) whose e-mails `fatura@` keeps | Those e-mails are refused |

### Public values (`apps/neko/wrangler.jsonc`, `vars`)

`SITE_URL` (the site's origin, used for the Pluggy webhook and Mia 2), `ANDROID_PACKAGE` and
`ANDROID_CERT_SHA256` (published in `assetlinks.json`), `SENTRY_DSN`, `VAPID_PUBLIC_KEY`, and
`GOOGLE_CLIENT_ID` (empty: the Google sign-in button stays off and only passkeys are used).

### GitHub Actions secrets

| Secret | Used by |
|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `ci.yml`, deploy on merge to `main` |
| `NEKO_WRITER_SERVICE_ACCOUNT_JSON`, `NEKO_TEST_SHEET_ID` | `ci.yml`, writer contract tests |
| `PLAY_SERVICE_ACCOUNT_JSON` | `play.yml`, `play-listing.yml` (a Play-only account with no access to the sheet) |
| `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_PASSWORD` | `play.yml`, signing the bundle |

### User settings

Everything the owner can change (teto do mês, cards and closing days, cards paid by someone else,
banks, Diário previsto, evening hour, writing on/off) lives in D1 and is edited in Ajustes. There
is no config file for it.

## Deploying

Merging to `main` deploys: `ci.yml` runs the checks, then `pnpm run deploy` (Vite build plus
`wrangler deploy`). `pnpm deploy` does the same from a machine with Cloudflare credentials.
Only the live version answers (`preview_urls: false`). The Worker runs on the Workers Paid plan,
because a full read needs more than the free plan's CPU limit.

### D1 migrations

- A schema change is a new numbered file in `apps/neko/migrations/`. Never edit an applied one.
- The deploy never touches the database. Apply migrations by hand, with the owner's written OK,
  before merging the PR that needs them:
  `pnpm --filter @neko/app db:migrate:remote`.
- Make code tolerate both the old and the new schema when a migration and a deploy cannot land
  at the same moment.

### Android releases

- `android.yml` builds, lints and tests the app on every PR that touches `apps/android/` or
  `apps/neko/src/shared/`, and uploads the Roborazzi screenshots as the `android-screenshots`
  artifact (including `stress/`: small phone, large text, long names).
- `play.yml` publishes every such change merged to `main` to the Play internal testing track:
  `versionCode` is `100 + run number`, and the squash commit's subject becomes the pt-BR release
  note. Bump `versionName` in `apps/android/app/build.gradle.kts` for a change testers will see.
- `play-listing.yml` uploads the store pictures in `apps/android/store/` when they change.
- The upload key never enters Git or CI logs: CI gets it from the secrets above, and local
  release builds read `apps/android/signing.properties` (gitignored).

## Scheduled jobs

Crons run in UTC; São Paulo is UTC−3 all year.

| Cron (UTC) | São Paulo | What runs |
|---|---|---|
| `0 9 * * *` | 06:00 | Bank sync, subscription check, then Mia's routine (Sundays and the 1st) |
| `0 11 * * *` | 08:00 | Housekeeping, sheet read, sheet-revision backfill, morning message |
| `30 21-23,0-1 * * *` | 18:30–22:30 | Bank sync, only on the run half an hour before the evening hour |
| `0 22-23,0-2 * * *` | 19:00–23:00 | Evening message, only at the hour chosen in Ajustes |

## One-time setups

- **Signing in a new device.** Sign-in is by passkey; a one-time invite creates the first one.
  Make a random token, store only its SHA-256 (hex) in `passkey_invite` with an allowed e-mail and
  an ISO expiry, and open `<site>/?convite=<token>`:

  ```sh
  TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
  HASH=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$TOKEN")
  pnpm --filter @neko/app exec wrangler d1 execute neko --remote --command \
    "INSERT INTO passkey_invite (token_hash, email, expires_at) VALUES ('$HASH', '<allowed e-mail>', '<ISO expiry>')"
  ```

  After that, the passkey syncs through the password manager, and the Android app uses the same
  one (`assetlinks.json`).
- **Open Finance.** Owner steps in `specs/003-open-finance/spec.md` ("Passos do dono"). Each
  bank's `itemId` goes in Ajustes › Bancos. The webhook address is registered from `SITE_URL`.
- **E-mail.** Cloudflare Email Routing sends `fatura@` on the Neko domain to the Worker. Gmail
  filters on the owner's account forward the banks' bills, billers' e-mails and Meu Pluggy's
  sign-in link there.
- **Mia.** Set `ANTHROPIC_API_KEY` and `MIA_MCP_TOKEN`. On the first question the Worker creates
  the agent, environment and memory store at Anthropic and keeps their ids in `mia2_setup`; a
  change to her configuration makes a new agent version, used by new conversations.
- **Protecting the sheet.** The writer account must not be able to touch Data, Saldo, headers,
  totals or other tabs: protected ranges are set by a script kept outside Git (see
  `specs/005-lancamentos/spec.md`, "Proteções da gravação").

## Monitoring

- Errors: Sentry (`SENTRY_DSN`), both from the Worker and from the web app through
  `/api/client-error`. Workers observability keeps the logs.
- Sheet unreadable or Meu Pluggy signed out: the Worker raises a notice to the owner's devices
  (`notice` table) and clears it once the problem is gone.
- Costs: Cloudflare usage on the account dashboard. Mia's spending is booked in `mia_usage`
  against a monthly cap; once it is reached she pauses until the next month and says so.
- Usage: Ajustes › Uso do Neko shows how often each screen and button was used in the last 30
  days (counts only).
