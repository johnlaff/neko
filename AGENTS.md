# AGENTS.md

Neko reads a personal Google Sheet (the source of truth, filled by hand) and computes views from
it, on the web and on Android. Read `ARCHITECTURE.md` for the code map and `specs/README.md` for
the feature specs. Public repo: no real finances, names, sheet id or e-mails in code, tests or
docs (use invented data like `apps/neko/e2e/make-projection.ts`), and never commit keys.

## Hard rules

- The owner's real sheet copy lives outside Git; `NEKO_REAL_SHEET=<path> pnpm test` runs the
  real-sheet acceptance test against it. `SHEET_ID` and `ALLOWED_EMAILS` are Worker secrets.
- Neko writes to the sheet only through the entries feature (`specs/005-lancamentos`), only when the
  owner taps an action (Lançar, Desfazer), and only Entrada/Saída/Diário cells that `checkCell`
  fully understands, via `planCellEdit`, plus the month's Economia cell next to a reserve line
  (`checkEconomia`, `planEconomiaEdit`). Never Data, Saldo, headers or other tabs, and nothing
  automatic: the bank, e-mail, the phone and Mia only propose items in "Para lançar"
  (`packages/engine/src/queue.ts`); cron and webhooks never write. Writes go through `/api/entries`
  (`apps/neko/src/worker/entries.ts`), one at a time, and stop when writing is switched off in
  Ajustes. Reads use the read-only service account (`GOOGLE_SERVICE_ACCOUNT_JSON`); writes use the
  separate `neko-writer` account (`NEKO_WRITER_SERVICE_ACCOUNT_JSON`). Any other Google key never
  enters this repo or its secrets.
- Money is integer cents (`Cents`), dates are civil `LocalDate` strings, time zone
  `America/Sao_Paulo` lives in `packages/engine/src/date.ts` only. The engine never reads the clock.
- Finance rules live in `packages/engine` with tests (TDD). The Worker and UI only orchestrate and
  display; the UI does no finance math beyond formatting. Web and Android ship the same features.
- Neko makes no forecasts of its own: only what the method allows (Diário previsto) and Simular,
  which saves nothing.
- The sheet reader validates structure (`SHEET_MAP`) and fails loudly; unknown note lines become
  health issues, not guesses.
- Bump `PIPELINE_VERSION` in `apps/neko/src/worker/pipeline.ts` when engine or reader output changes,
  so cached projections are recomputed.

## Workflow

- `pnpm check` before pushing (Biome, TypeScript, Vitest). CI runs the same plus the build and e2e.
- D1 schema changes are new files in `apps/neko/migrations/`; never edit an applied migration.
  Applying them (or any other change to the remote database) needs the owner's written OK.
- A change in behavior updates its spec in the same PR; a new feature gets a new numbered spec.
  Update `ARCHITECTURE.md` when a module, flow or invariant changes.
- The API contract fixtures in `apps/android/app/src/test/resources/` are written by the
  TypeScript tests: `UPDATE_CONTRACT=1 pnpm test` after an intended change, then the Kotlin tests
  read them.
- Commits and PR titles in pt-BR, describing what changed and why. The squash subject becomes the
  Play release note, so write it for the person using the app.

## Checking the Android screens

- No phone needed: Roborazzi draws every screen on the JVM. CI uploads them as the
  `android-screenshots` artifact on each Android run, including `stress/` (small phone, large
  text, long names). Look at them before merging a screen change.
- Real numbers, privately: `NEKO_REAL_SHEET=<path> apps/android/real-prints.sh <out-dir>` draws
  the screens from the owner's sheet copy into a folder outside Git. Never commit those prints.
