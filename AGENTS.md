# AGENTS.md

Neko v2 reads a personal Google Sheet (the source of truth, filled by hand) and computes views
from it. Public repo: no real finances, names, sheet id or e-mails in code, tests or docs (use
invented data like `apps/neko/e2e/make-projection.ts`), and never commit keys.

## Hard rules

- The owner's real sheet copy lives outside Git; `NEKO_REAL_SHEET=<path> pnpm test` runs the
  real-sheet acceptance test against it. `SHEET_ID` and `ALLOWED_EMAILS` are Worker secrets.
- Neko never writes to the sheet. Only the read-only service account (`GOOGLE_SERVICE_ACCOUNT_JSON`)
  goes into Worker secrets. Any other Google key never enters this repo or its secrets.
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
