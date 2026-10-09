# AGENTS.md

Neko v2 reads a personal Google Sheet (the source of truth, filled by hand) and computes views
from it. Public repo: no real finances, names, sheet id or e-mails in code, tests or docs (use
invented data like `apps/neko/e2e/make-projection.ts`), and never commit keys.

## Hard rules

- The owner's real sheet copy lives outside Git; `NEKO_REAL_SHEET=<path> pnpm test` runs the
  real-sheet acceptance test against it. `SHEET_ID` and `ALLOWED_EMAILS` are Worker secrets.
- Neko writes to the sheet only through the entries feature (`specs/005-lancamentos`), only when the
  owner taps an action, and only Entrada/Saída/Diário cells that `checkCell` fully understands, via
  `planCellEdit`. Never Data, Saldo, headers or other tabs, and nothing automatic (bank, Mia, cron).
  Until Fase 1 ships, no code path writes. Reads use the read-only service account
  (`GOOGLE_SERVICE_ACCOUNT_JSON`); writes will use a separate `neko-writer` account. Any other Google
  key never enters this repo or its secrets.
- Money is integer cents (`Cents`), dates are civil `LocalDate` strings, time zone
  `America/Sao_Paulo` lives in `packages/engine/src/date.ts` only. The engine never reads the clock.
- Finance rules live in `packages/engine` with tests (TDD). The Worker and UI only orchestrate and
  display; the UI does no finance math beyond formatting.
- The sheet reader validates structure (`SHEET_MAP`) and fails loudly; unknown note lines become
  health issues, not guesses.
- Bump `PIPELINE_VERSION` in `apps/neko/src/worker/pipeline.ts` when engine or reader output changes,
  so cached projections are recomputed.

## Workflow

- `pnpm check` before pushing (Biome, TypeScript, Vitest). CI runs the same plus the build.
- D1 schema changes are new files in `apps/neko/migrations/`; never edit an applied migration.
- Commits and PR titles in pt-BR, describing what changed and why.

## Checking the Android screens

- No phone needed: Roborazzi draws every screen on the JVM. CI uploads them as the
  `android-screenshots` artifact on each Android run, including `stress/` (small phone, large
  text, long names). Look at them before merging a screen change.
- Real numbers, privately: `NEKO_REAL_SHEET=<path> apps/android/real-prints.sh <out-dir>` draws
  the screens from the owner's sheet copy into a folder outside Git. Never commit those prints.

