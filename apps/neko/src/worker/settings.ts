import { z } from "zod";
import { UserSettings } from "../shared/types.ts";

export { UserSettings };

const KEY = "user";

export const loadSettings = async (db: D1Database): Promise<UserSettings> => {
  const row = await db
    .prepare("SELECT value FROM setting WHERE key = ?")
    .bind(KEY)
    .first<{ value: string }>();
  return UserSettings.parse(row ? JSON.parse(row.value) : {});
};

export const saveSettings = async (db: D1Database, settings: UserSettings): Promise<void> => {
  await db
    .prepare(
      "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .bind(KEY, JSON.stringify(settings))
    .run();
};

/** Hash of what the projection depends on; checked Conferência points only change the screen. */
export const settingsHash = async ({ reviewed: _, ...s }: UserSettings): Promise<string> => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(s)));
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
};

/**
 * Fields set elsewhere than the Ajustes form (Ajustes › Bancos, Para lançar): a settings body that
 * does not send them (Ajustes itself, or an older app) keeps the ones saved.
 */
const KEPT = ["bankCards", "accountUse", "savedOrigins", "writing"] as const;

export const keepBankCards = (body: unknown, current: UserSettings): UserSettings => {
  const b = z.record(z.string(), z.unknown()).parse(body);
  const kept = Object.fromEntries(KEPT.filter((k) => !(k in b)).map((k) => [k, current[k]]));
  const next = UserSettings.parse({ ...b, ...kept });
  // The Diário previsto changes only through its own route, which writes the sheet with it: its
  // value is then the one on the days ahead.
  return {
    ...next,
    previstoSince: current.previstoSince,
    ...(current.previstoSince !== null ? { dailyForecast: current.dailyForecast } : {}),
  };
};
