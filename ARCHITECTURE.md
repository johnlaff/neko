# Architecture

How Neko is put together, for someone (or some agent) about to change it. It names files and
types instead of linking them, and covers only what changes rarely; the behavior of each feature
lives in `specs/`. Last checked against the code on 2026-11-17.

## Bird's eye view

The owner keeps a Google Sheet by hand, in the "gasto diário" method: one row per day, with
Entrada, Saída, Diário and Saldo columns, and each amount explained in the cell's note
(`R$ 12,34 - Mercado`). The sheet is the source of truth. Neko reads it, computes what the sheet
does not show on its own (what still fits this month, each card's bill before it arrives, the
months ahead, the reserve), and checks it against the banks.

```
            Google Sheet ──read (Viewer)──┐        ┌── Meu Pluggy (Open Finance, read only)
                 ▲                        ▼        ▼
   write on tap  │     ┌──────────── Cloudflare Worker ────────────┐   fatura@ e-mail
   (neko-writer) └─────┤ Hono API /api · React SPA · D1 · crons    │◄── (bills, sign-in links)
                       │ sheet-reader → engine → views             │
                       └──────┬─────────────────────────┬──────────┘
                              │ same JSON               │ MCP (read only + propose)
                    web (SPA) │ Android (thin client)   ▼
                                              Mia 2 (Anthropic managed agent)
```

One Worker serves everything: the API under `/api`, the web app as static assets, a D1 database,
scheduled jobs and an e-mail handler. The Android app is a thin client of the same API.

## Code map

A pnpm workspace with two pure packages and two apps.

### `packages/engine`

Every finance rule, as pure functions over integer cents (`Cents`, `money.ts`) and civil dates
(`LocalDate`, `date.ts`). "Today" is always a parameter; nothing here reads the clock, the network
or the database. The entry point is `project` (`projection.ts`), which turns a ledger plus settings
into the `Projection` every screen reads. Around it:

- Method rules: `balance.ts` (saldo chain), `cards.ts` (card cycles), `installments.ts`,
  `savings.ts` (how much can be kept on payday), `reserve.ts` (the reserve in steps),
  `thermometer.ts`, `habit.ts` (the streak), `recap.ts`, `breakdown.ts` and `trend.ts`
  (where the money went), `health.ts` and `insights.ts` (what needs a look).
- Bank side: `bank.ts` (bank vs sheet), `statement.ts` (the bank's PDF bill), `transfers.ts`,
  `subscriptions.ts`, `watch.ts` (the daily watch: a charge that came twice, a refund),
  `owners.ts` (purchases that are someone else's), `phone.ts` (purchase notices read by the phone).
- Entries: `entries.ts` (`EntryInput`, `placeEntry`), `queue.ts` ("Para lançar"),
  `forecast.ts` (Diário previsto), `mia-entry.ts`.
- What-ifs: `scenario.ts` (Simular), `purchase.ts` ("Posso comprar?").
- `mia.ts`: Mia 1's tools and the answer check.

### `packages/sheet-reader`

The only code that knows the sheet's layout. `SHEET_MAP` (`grid.ts`) says where everything lives
in a year tab; `readSpreadsheet` (`ledger.ts`) turns a `spreadsheets.get` response into a ledger
and throws `SheetStructureError` on anything unexpected. `note.ts` holds the note grammar.
`edit.ts` plans writes: `checkCell` accepts only a cell it fully understands, and `planCellEdit`
returns the new formula and note exactly as the owner would type them.

### `apps/neko` (the Worker and the web app)

- `src/worker/index.ts`: the Hono router, the `scheduled` handler (crons) and the `email`
  handler. Every route that reads or changes data requires a session; the exceptions are sign-in,
  a few public config routes, the Pluggy webhook (shared secret) and the token-guarded MCP and
  inbox endpoints.
- `src/worker/pipeline.ts`: sheet → projection, cached in D1 (see "Reading the sheet" below).
  `PIPELINE_VERSION` lives here.
- Sign-in: `auth.ts` (sessions), `passkey.ts` (WebAuthn), `android.ts` (`assetlinks.json`).
- Banks: `pluggy.ts` (API client, webhook, sync), `meupluggy.ts` (refresh through the owner's
  Meu Pluggy session), `bank.ts` (rows to engine types).
- Writing: `writer.ts` (the only code that writes to the sheet), `entries.ts` (`/api/entries`
  and `/api/queue`), `google.ts` (the two service accounts).
- E-mail: `inbox.ts` (`fatura@`), `statement.ts` and `pdf.ts` (the bank's PDF bill).
- Messages: `push.ts` (what to say), `notices.ts` (getting it to the browser and the phone).
- Mia: `mia.ts` (Mia 1, Messages API), `mia2.ts` (Mia 2, managed agent), `mcp.ts` (her tools),
  `grounding.ts` (her number check), `routines.ts` (Sunday and month-end summaries),
  `proposals.ts` (entries she leaves in Para lançar), `note.ts` (Mia's line on Hoje: what was
  tapped or set aside).
- `src/shared/`: the API contract. `screens.ts`, `today.ts` and `queue.ts` build the views both
  clients draw; `note.ts` writes Mia's line from the watch's and her routine's own numbers;
  `types.ts` holds the response types.
- `src/web/`: React 19 SPA with TanStack Router and Query. Screens in `web/screens/` (Hoje,
  Faturas, Mês, Simular, Ajustes) plus the Mia screen (`Mia.tsx`, `Mia2.tsx`). Faturas' pages
  live in `web/faturas/` (a card's bill, a person's month, the subscriptions and their review,
  the "De quem é?" form), opened through the URL's search (`?cartao=`, `?pessoa=`,
  `?revisar=true`); what a tap opens over a page is a `Sheet.tsx` (a native `<dialog>`).
- `migrations/`: D1 schema, one numbered file per change.
- `test/` (Vitest, with an in-memory D1 in `test/d1.ts`) and `e2e/` (Playwright on a projection
  built from invented data by `e2e/make-projection.ts`).

### `apps/android`

Kotlin, Jetpack Compose and Glance, package `dev.johnlaff.neko`. `data/` talks to the API and
keeps an encrypted cache, `ui/` has one file per screen (Faturas' pages in `CardBill.kt`,
`PersonPage.kt`, `Subscriptions.kt` and `OwnerForm.kt`), and `widget/`, `tile/`, `shortcuts/`,
`reminders/`, `purchases/` (purchase notices), `security/` (app lock) and `share/` hold the
Android-only parts. The app formats and draws; any figure it shows comes ready from the API.

The contract between the two apps is checked on both sides: TypeScript tests write JSON fixtures
into `apps/android/app/src/test/resources/` (`UPDATE_CONTRACT=1` rewrites them after an intended
change) and the Kotlin tests parse and draw them. Roborazzi turns those drawings into screenshots.

## Main flows

**Reading the sheet.** One Drive call returns the file's version. If the version, the day, the
settings and the bank data are the same as a cached snapshot, the snapshot is served (a D1 read).
Otherwise `spreadsheets.get` fetches last year's, this year's and next year's tabs with a field
mask (values, formulas, notes), `readSpreadsheet` validates them, `project` computes, and the
result is stored in `snapshot`. `PIPELINE_VERSION` is part of the cache key.

**Banks.** Meu Pluggy reads the owner's banks through regulated Open Finance; Neko reads Meu
Pluggy through the Pluggy API. A webhook only says "look at item X"; the Worker then fetches the
data itself. A daily sync at 06:00 re-reads the last weeks as a safety net. The bank never changes
a balance or a bill: it feeds checks and proposals only.

**Para lançar → the sheet.** `buildQueue` compares bank and sheet and proposes items already in
the method's shape. The owner taps Lançar (or launches by hand, or accepts a sentence parsed by
Mia). The client sends a draft, never cells; the Worker turns it into placements, previews them,
and `writer.ts` writes one entry at a time: re-read, journal in `entry_op`, one `batchUpdate`,
read back, roll back on any mismatch. Desfazer restores the cells if they are still as Neko left
them.

**Someone else's part.** Marks in `setting` (Faturas › De quem é) say whose a purchase on the
owner's card is, all of it or a share of each charge; a parcel's mark holds its whole plan and a
subscription's every month. Only the owner's part counts in the ceiling. `buildQueue` plans the
other part as an Entrada on each due day (a `parte` draft in Para lançar, written only on the
owner's tap), or nothing for a person whose part goes in when their Pix lands.

**E-mail.** Cloudflare Email Routing delivers `fatura@` on the Neko domain to the Worker. It keeps
only mail from the owner's own forwarding and from known senders: the bank's PDF bill (read by
Claude and kept only if every sum closes), a card's "bill closed" e-mail, billers' e-mails (light,
phone) and Meu Pluggy's sign-in link. Nothing from e-mail reaches the sheet directly.

**Notifications.** At most a morning message (08:00) and an evening message (at the owner's hour),
each only when there is something to do, plus rare alerts. Browsers get Web Push; the Android app
has no push service and asks the API at those hours and every 3 hours with the widget.

**Mia 2.** The Worker creates an Anthropic managed agent once and opens a session per
conversation. The agent reads Neko through the MCP endpoint `/api/mcp` (bearer token), does sums
in its sandbox and draws charts and number boards through custom tools. The Worker relays her
events to the client as NDJSON, checks every R$ she writes against tool and code output
(`grounding.ts`) and books the cost against a monthly cap. Her only non-read tool,
`propor_lancamento`, leaves an item in Para lançar. Mia 1 (Haiku, then Sonnet, over the Messages
API) still answers when Mia 2 is not configured, and parses "Numa frase" in Lançar.

## Invariants

These are mostly things that are absent, so they are easy to break without noticing.

- **Nothing writes to the sheet without the owner's tap.** Only `writer.ts` writes, only from
  `/api/entries`, only Entrada/Saída/Diário cells that `checkCell` accepts and the month's cell of
  the Economia tab. Crons, webhooks, e-mail, the phone and Mia only propose. Writing can be
  switched off in Ajustes.
- **Two Google identities.** Reads use a Viewer account with read-only scopes; writes use the
  separate `neko-writer` account. No other Google key enters the repository or its secrets.
- **No forecasts of Neko's own.** Numbers come from the sheet and the bank. The only look ahead is
  what the method itself allows (Diário previsto) and Simular, which saves nothing.
- **The engine is pure.** No clock, no I/O, no floats for money, one time zone
  (`America/Sao_Paulo`, in `date.ts` only).
- **Clients do no finance math.** Web and Android draw what the API computed; a new figure is a new
  API field with a TypeScript test. Web and Android ship the same features (Android adds the
  widget, tile, shortcuts, app lock and purchase notices).
- **The reader fails loudly.** An unexpected sheet structure stops the read; an unreadable note
  line becomes a health issue, never a guess.
- **Untrusted input is parsed at the boundary.** Zod on every request body, webhook and external
  API response; webhooks carry no data that is trusted.
- **No personal data in the repository.** The sheet id, allowed e-mails, bank passwords and
  biller domains are secrets; tests and screenshots use invented data.

## Where state lives

| Store | What |
|---|---|
| Google Sheet | The money. Everything else can be rebuilt from it and the banks. |
| D1 `snapshot`, `setting` | Cached projections and month-end history; settings edited in Ajustes. |
| D1 `session`, `passkey`, `passkey_invite`, `webauthn_challenge`, `push_subscription` | Devices and sign-in. Tokens are stored only as SHA-256. |
| D1 `bank_*`, `meu_pluggy`, `statement*`, `mailed_*` | What banks and e-mails said. Only fields a screen uses. |
| D1 `entry_op`, `queue_decision`, `mia_proposal` | The write journal and what the owner decided in Para lançar. |
| D1 `notice`, `phone_purchase`, `bank_notice`, `usage_day` | Pending notices, phone reads (15 days), usage counts (no amounts). |
| D1 `mia_usage`, `mia2_setup`, `mia2_session` | Mia's spending and the Anthropic objects the Worker created. |
| Anthropic | Mia 2's agent, sessions and memory store. |

## External services

| Service | Used for | If missing |
|---|---|---|
| Google Sheets and Drive API | Reading (and, on tap, writing) the sheet | Neko does not work |
| Meu Pluggy / Pluggy API | Bank data | Bank checks and Para lançar stay empty |
| Anthropic API | Mia, PDF bill reading | Mia is hidden; PDFs are not read |
| Cloudflare Email Routing | `fatura@` | Bills come only through the Faturas button |
| Web Push (VAPID) | Browser notifications | The Android app still checks in |
| Sentry | Error reports | Errors stay in Workers logs |
| Google Play | Android distribution (internal testing) | Install the APK by hand |
