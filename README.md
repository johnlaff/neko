# Neko

A personal finance companion, on the web and on Android, for someone who keeps a Google Sheet by
hand in the "gasto diário" method (Escola do Breno). The sheet stays the source of truth. Neko
reads it, checks it against the bank, and shows what the sheet does not show on its own: how much
still fits in the month, each card's bill before it arrives, the months ahead and the reserve. It
writes to the sheet only when the owner taps Lançar, exactly as the owner would type it.

Neko is built for one person and one sheet. The code is public; it holds no real data (tests and
screenshots use invented numbers, and everything that identifies the owner is a secret).

## What it does

- **Hoje**: how much still fits under the month's ceiling (cards and Pix), what the bank shows
  that the sheet does not have yet (**Para lançar**), the daily-logging streak, and only the
  warnings that ask for action.
- **Lançar**: an income, an expense or a card purchase in installments, previewed cell by cell,
  written as a new line in the cell's note and formula, and undoable.
- **Faturas**: each card's bill as the sheet and the bank see it, installments already bought,
  subscriptions, purchases that someone else will pay back, and the bank's own PDF bill.
- **Mês**: each month from the sheet, months heading below zero, where the money went, what was
  kept, and the emergency reserve in steps.
- **Simular**: the months ahead under a spending pace and what-ifs. Nothing is saved.
- **Mia**: an assistant that answers from Neko's own numbers, with charts, says whether a purchase
  fits ("Posso comprar?"), sums up the week and the month, and can leave an entry in Para lançar.
- **Notifications**: a morning and an evening message only when there is something to do. On
  Android also a widget, a quick-settings tile, shortcuts, an app lock and purchase notices read
  from the bank apps (learning only, for now).

The banks come in read-only through Open Finance (Meu Pluggy). Card bills and utility bills can
also arrive by e-mail. Nothing from the bank, the e-mail, the phone or Mia reaches the sheet
without the owner's tap.

## How it is built

One Cloudflare Worker serves the Hono API, the React web app and a D1 database, and runs the
scheduled jobs and the e-mail handler. The Android app (Kotlin, Compose, Glance) is a thin client
of the same API. Finance rules live in a pure TypeScript package with tests; the sheet's layout
lives in another. Mia 2 is an Anthropic managed agent that reads Neko through an MCP endpoint.

| Path | What |
|---|---|
| `packages/engine` | Every finance rule: pure functions over integer cents and civil dates |
| `packages/sheet-reader` | The sheet's layout: validated reading and exact cell edits |
| `apps/neko` | The Worker (API, crons, e-mail, Mia) and the web app |
| `apps/android` | The Android app and widget |
| `specs/` | What each feature does and why, in pt-BR |

## Getting started

```sh
pnpm install
pnpm check      # lint, typecheck and tests
pnpm dev        # web app and Worker locally (needs apps/neko/.dev.vars)
```

Configuration, deploys, migrations and Android builds are in `docs/operations.md`.

## Documentation

| Document | For |
|---|---|
| `ARCHITECTURE.md` | How the pieces fit, the main flows and the rules the code must keep |
| `docs/operations.md` | Running, configuring, deploying and monitoring |
| `specs/` | Each feature's behavior and decisions (index in `specs/README.md`) |
| `AGENTS.md` | Rules for coding agents working in this repository |
| `SECURITY.md` | The security model and how to report a problem |
| `apps/android/store/README.md` | The Play Store listing |

Docs next to the code are in English, like the code. Specs and anything the owner reads in the
app are in Brazilian Portuguese, like the method.
