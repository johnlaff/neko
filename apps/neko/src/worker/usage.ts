import { addDays, type LocalDate } from "@neko/engine";
import { z } from "zod";
import { USAGE, type UsageApp, type UsageEvent, type UsageSummary } from "../shared/usage.ts";

/** Only the known names travel: anything else is refused, so nothing else can be stored. */
export const UsagePost = z.object({
  event: z.enum(Object.keys(USAGE) as [UsageEvent, ...UsageEvent[]]),
  app: z.enum(["web", "android"]),
});

const WINDOW = 30;

/** One more use of `event` today on `app`. */
export const recordUse = async (
  db: D1Database,
  day: LocalDate,
  event: UsageEvent,
  app: UsageApp,
) => {
  await db
    .prepare(
      "INSERT INTO usage_day (day, event, app, count) VALUES (?, ?, ?, 1) ON CONFLICT (day, event, app) DO UPDATE SET count = count + 1",
    )
    .bind(day, event, app)
    .run();
};

/** The last 30 days, today included: on how many days Neko was opened, and how often each thing. */
export const usageSummary = async (db: D1Database, today: LocalDate): Promise<UsageSummary> => {
  const since = addDays(today, -(WINDOW - 1));
  const [events, apps] = await Promise.all([
    db
      .prepare("SELECT event, SUM(count) AS n FROM usage_day WHERE day >= ? GROUP BY event")
      .bind(since)
      .all<{ event: string; n: number }>(),
    db
      .prepare(
        "SELECT app, COUNT(DISTINCT day) AS d FROM usage_day WHERE day >= ? GROUP BY app UNION ALL SELECT 'all', COUNT(DISTINCT day) FROM usage_day WHERE day >= ?",
      )
      .bind(since, since)
      .all<{ app: string; d: number }>(),
  ]);
  const count = new Map(events.results.map((r) => [r.event, Number(r.n)]));
  const days = (app: string) => Number(apps.results.find((r) => r.app === app)?.d ?? 0);
  return {
    window: WINDOW,
    days: days("all"),
    android: days("android"),
    web: days("web"),
    events: (Object.entries(USAGE) as [UsageEvent, string][]).map(([event, label]) => ({
      event,
      label,
      count: count.get(event) ?? 0,
    })),
  };
};
