import {
  cents,
  type DailySuggestion,
  editDay,
  type Habit,
  habit,
  inferCards,
  inferDailyForecast,
  type LocalDate,
  localDate,
  mergeCards,
  monthsSince,
  notMyCardLines,
  parts,
  project,
  REVIEW_MONTHS,
  type SpendInput,
  suggestDaily,
  variableSpend,
} from "@neko/engine";
import {
  type ApiSpreadsheet,
  readSpreadsheet,
  SHEET_FIELDS,
  yearTabRanges,
} from "@neko/sheet-reader";
import type {
  DailyForecast,
  DailySource,
  HistoryPoint,
  PrevistoView,
  ProjectionResponse,
  UserSettings,
} from "../shared/types.ts";
import { type BankRows, bankInput, bankVersion, bankView, loadBank } from "./bank.ts";
import type { Env } from "./env.ts";
import { accessToken, fileVersion, revisionTimes, spreadsheet, tabs } from "./google.ts";
import { loadSettings, settingsHash } from "./settings.ts";

/** Increment when the engine or reader changes output, so cached projections are recomputed. */
const PIPELINE_VERSION = "48";

/**
 * A cached projection still says when the sheet was last checked: the Drive call above just
 * confirmed the same file version, so "Lida" is now, not when the snapshot was first computed.
 */
export const checkedAt = (r: ProjectionResponse, at: Date): ProjectionResponse => ({
  ...r,
  sheet: { ...r.sheet, readAt: at.toISOString() },
});

/**
 * read sheet → validate → ledger → pure engine → projection, cached per (file version, today,
 * settings). Unchanged sheet and same day: one Drive call and a D1 read.
 */
export const getProjection = async (env: Env, today: LocalDate): Promise<ProjectionResponse> => {
  // Independent reads go out together: every screen switch waits on this, so each round trip
  // to Google or D1 saved is time the person does not wait.
  const [file, settings, bank] = await Promise.all([
    accessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON).then(async (token) => ({
      token,
      ...(await fileVersion(env.SHEET_ID, token)),
    })),
    loadSettings(env.DB),
    loadBank(env.DB),
  ]);
  const [habit, response] = await Promise.all([
    recordEdits(env.DB, [file.modifiedTime]).then(() => loadHabit(env.DB, today)),
    readProjection(env, today, file.token, file, settings, bank),
  ]);
  // Fresh on every read, like the streak: switching writing off must hide the buttons at once.
  const writing = settings.writing && Boolean(env.NEKO_WRITER_SERVICE_ACCOUNT_JSON);
  return { ...response, habit, writing };
};

const readProjection = async (
  env: Env,
  today: LocalDate,
  token: string,
  file: { version: string; modifiedTime: string },
  settings: UserSettings,
  bank: BankRows | null,
): Promise<ProjectionResponse> => {
  const hash = `${PIPELINE_VERSION}:${await settingsHash(settings)}:${bankVersion(bank)}`;
  const version = `${file.version}`;

  const hit = await env.DB.prepare(
    "SELECT projection FROM snapshot WHERE file_version = ? AND today = ? AND settings_hash = ? AND projection != '{}' ORDER BY id DESC LIMIT 1",
  )
    .bind(version, today, hash)
    .first<{ projection: string }>();
  if (hit) return checkedAt(JSON.parse(hit.projection) as ProjectionResponse, new Date());

  const { year } = parts(today);
  const tabGids = await tabs(env.SHEET_ID, token);
  const years = [year - 1, year, year + 1].filter((y) => String(y) in tabGids);
  const doc = (await spreadsheet(
    env.SHEET_ID,
    token,
    yearTabRanges(years),
    SHEET_FIELDS,
  )) as ApiSpreadsheet;
  const response = buildResponse(
    doc,
    today,
    settings,
    {
      id: env.SHEET_ID,
      version,
      modifiedTime: file.modifiedTime,
      readAt: new Date().toISOString(),
      tabs: tabGids,
    },
    bank,
  );
  const { projection } = response;
  const { month } = parts(today);
  const monthEnd =
    projection.months.find((m) => m.year === year && m.month === month)?.endSheet ?? null;
  await env.DB.prepare(
    "INSERT INTO snapshot (file_version, today, settings_hash, month_end_projected, projection) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(version, today, hash, monthEnd, JSON.stringify(response))
    .run();
  return response;
};

/**
 * The pure half of the pipeline: the sheet as Sheets returned it, plus settings, to the response
 * every screen reads. Also used to draw the app's screens from a private copy of the real sheet.
 */
export const buildResponse = (
  doc: ApiSpreadsheet,
  today: LocalDate,
  settings: UserSettings,
  sheet: ProjectionResponse["sheet"],
  bank: BankRows | null = null,
): ProjectionResponse => {
  const { ledger, ceiling } = readSpreadsheet(doc);

  const cards = mergeCards(inferCards(ledger), settings.cards);
  const inferred = inferDailyForecast(ledger, today, notMyCardLines(ledger, settings.othersCards));
  const sheetNote =
    ceiling !== null && ceiling.date <= today
      ? { perDay: ceiling.perDay, date: ceiling.date }
      : null;
  const source: DailySource =
    settings.dailyForecast !== null
      ? "settings"
      : sheetNote !== null && sheetNote.perDay >= inferred
        ? "sheet-note"
        : "inferred";
  const dailyForecast = cents(
    source === "settings"
      ? (settings.dailyForecast ?? 0)
      : source === "sheet-note"
        ? (sheetNote?.perDay ?? 0)
        : inferred,
  );
  const daily: DailyForecast = { value: dailyForecast, source, sheetNote, inferred };

  // The Diário previsto (specs/005-lancamentos, Fase 3) needs the bank: what a day costs, and
  // what this month already cost.
  const input = bank && bankInput(bank, settings.bankCards, cards);
  const spend: SpendInput | null = input && {
    ledger,
    today,
    movements: input.movements,
    lines: input.lines,
    othersCards: settings.othersCards,
    savingsAccounts: new Set(
      Object.entries(settings.accountUse)
        .filter(([, use]) => use === "guardado")
        .map(([id]) => id),
    ),
    savedOrigins: new Set(settings.savedOrigins),
  };
  const on = settings.previstoSince !== null && dailyForecast > 0;
  const suggestion = spend && suggestDaily(spend);
  const projection = project(ledger, today, {
    dailyForecast,
    usualCard: settings.usualCard,
    cycleBudget: settings.cycleBudget === null ? null : cents(settings.cycleBudget),
    cards,
    othersCards: settings.othersCards,
    previsto:
      on && spend
        ? {
            value: dailyForecast,
            spent: variableSpend(spend, localDate(`${today.slice(0, 8)}01`), today).total,
          }
        : null,
  });
  return {
    projection,
    daily,
    cardsKnown: cards,
    sheet,
    bank: bankView(bank, ledger, cards, settings, today, input),
    previsto: previstoView(settings, dailyForecast, today, suggestion, sheet.tabs),
  };
};

/** Ajustes and the review on Hoje: whether it is on, at what value, and what the bank suggests. */
const previstoView = (
  settings: UserSettings,
  value: number,
  today: LocalDate,
  suggestion: DailySuggestion | null,
  tabs: Readonly<Record<string, unknown>>,
): PrevistoView => {
  const since = settings.previstoSince === null ? null : localDate(settings.previstoSince);
  const due = since !== null && monthsSince(since, today) >= REVIEW_MONTHS;
  return {
    on: since !== null,
    value,
    since,
    suggestion,
    review: due && suggestion ? { real: suggestion.perDay, from: suggestion.from } : null,
    lastYear: Math.max(
      ...Object.keys(tabs)
        .filter((t) => /^\d{4}$/.test(t))
        .map(Number),
    ),
  };
};

/** How the current month's projected end moved, one point per sheet version. */
/** First pipeline whose month end is the sheet's own figure; earlier rows carried Neko's forecast. */
const SHEET_MONTH_END_SINCE = 29;

export const monthEndHistory = async (
  db: D1Database,
  today: LocalDate,
): Promise<HistoryPoint[]> => {
  const monthStart = `${today.slice(0, 7)}-01`;
  const { results } = await db
    .prepare(
      "SELECT created_at AS at, today, month_end_projected AS monthEndProjected FROM snapshot WHERE today >= ? AND month_end_projected IS NOT NULL AND CAST(substr(settings_hash, 1, instr(settings_hash, ':') - 1) AS INTEGER) >= ? ORDER BY id",
    )
    .bind(monthStart, SHEET_MONTH_END_SINCE)
    .all<HistoryPoint>();
  return results;
};

/** Keeps the cache small: old projections are dropped, the per-day history row stays. */
export const pruneSnapshots = async (db: D1Database): Promise<void> => {
  await db
    .prepare(
      "UPDATE snapshot SET projection = '{}' WHERE id NOT IN (SELECT MAX(id) FROM snapshot GROUP BY today) AND projection != '{}' AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')",
    )
    .run();
};

/** Long enough for the 365-day milestone and the best run of the year. */
const HABIT_WINDOW = 400;
const EDITS_KEY = "sheet_edits";

/**
 * The São Paulo days the sheet changed, newest last, kept as one settings row. Before the first
 * edit Neko records, the projections already cached say when the sheet changed on earlier days.
 */
const loadEditDays = async (db: D1Database): Promise<LocalDate[] | null> => {
  const row = await db
    .prepare("SELECT value FROM setting WHERE key = ?")
    .bind(EDITS_KEY)
    .first<{ value: string }>();
  return row ? (JSON.parse(row.value) as LocalDate[]) : null;
};

const cachedEditTimes = async (db: D1Database): Promise<string[]> => {
  const { results } = await db
    .prepare(
      "SELECT DISTINCT json_extract(projection, '$.sheet.modifiedTime') AS t FROM snapshot WHERE projection != '{}' AND json_extract(projection, '$.sheet.modifiedTime') IS NOT NULL",
    )
    .all<{ t: string }>();
  return results.map((r) => r.t);
};

/** Adds Drive edit instants to the record; writes only when a new day shows up. */
export const recordEdits = async (db: D1Database, times: readonly string[]): Promise<void> => {
  const known = await loadEditDays(db);
  const before = known ?? (await cachedEditTimes(db)).map(editDay);
  const days = [...new Set([...before, ...times.map(editDay)])].sort().slice(-HABIT_WINDOW);
  if (known && days.length === known.length && days.every((d, i) => d === known[i])) return;
  await db
    .prepare(
      "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .bind(EDITS_KEY, JSON.stringify(days))
    .run();
};

export const loadHabit = async (db: D1Database, today: LocalDate): Promise<Habit> =>
  habit((await loadEditDays(db)) ?? [], today);

/**
 * Drive keeps the sheet's revision history: it fills in the days the sheet changed before Neko
 * watched it, and any edit that a later one hid between two checks. Best effort, once a day.
 */
export const backfillEdits = async (env: Env): Promise<void> => {
  const token = await accessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  await recordEdits(env.DB, await revisionTimes(env.SHEET_ID, token));
};
