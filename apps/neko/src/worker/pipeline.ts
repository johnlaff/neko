import {
  cents,
  inferCards,
  inferDailyForecast,
  type LocalDate,
  mergeCards,
  notMyCardLines,
  parts,
  project,
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
  ProjectionResponse,
} from "../shared/types.ts";
import type { Env } from "./env.ts";
import { accessToken, fileVersion, spreadsheet, tabs } from "./google.ts";
import { loadSettings, settingsHash } from "./settings.ts";

/** Increment when the engine or reader changes output, so cached projections are recomputed. */
const PIPELINE_VERSION = "30";

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
  const token = await accessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const file = await fileVersion(env.SHEET_ID, token);
  const settings = await loadSettings(env.DB);
  const hash = `${PIPELINE_VERSION}:${await settingsHash(settings)}`;
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

  const projection = project(ledger, today, {
    dailyForecast,
    usualCard: settings.usualCard,
    cycleBudget: settings.cycleBudget === null ? null : cents(settings.cycleBudget),
    cards,
    othersCards: settings.othersCards,
  });
  const response: ProjectionResponse = {
    projection,
    daily,
    cardsKnown: cards,
    sheet: {
      id: env.SHEET_ID,
      version,
      modifiedTime: file.modifiedTime,
      readAt: new Date().toISOString(),
      tabs: tabGids,
    },
  };
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
