import { z } from "zod";
import { miaNote } from "../shared/note.ts";
import type { Mia2Rotina, MiaNote, ProjectionResponse } from "../shared/types.ts";

/**
 * Mia's line at the top of Hoje (specs/004-mia, "A linha da Mia em Hoje"): built on each read of
 * Hoje from the bank's watch and her latest routine, minus what was tapped or dismissed on any
 * device.
 */

const SEEN_KEY = "mia_note_seen";
/** More than a week of lines: older ones are no longer news anyway. */
const SEEN_KEEP = 100;

export const NoteSeenBody = z.object({
  id: z
    .string()
    .regex(/^(vigia|rotina):/)
    .max(300),
});

export const loadSeen = async (db: D1Database): Promise<string[]> => {
  const row = await db
    .prepare("SELECT value FROM setting WHERE key = ?")
    .bind(SEEN_KEY)
    .first<{ value: string }>();
  return row ? (JSON.parse(row.value) as string[]) : [];
};

/** Tapped or dismissed: the line goes, here and on the other devices. */
export const markSeen = async (db: D1Database, id: string): Promise<void> => {
  const seen = await loadSeen(db);
  if (seen.includes(id)) return;
  await db
    .prepare(
      "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .bind(SEEN_KEY, JSON.stringify([...seen, id].slice(-SEEN_KEEP)))
    .run();
};

/** The line for this read of Hoje; `rotina` is her routine while it is news, when Mia 2 is on. */
export const noteFor = async (
  db: D1Database,
  data: ProjectionResponse,
  mia: { readonly on: boolean; readonly rotina: Mia2Rotina | null },
): Promise<MiaNote | null> =>
  miaNote({
    watch: data.bank?.watch ?? [],
    subscriptions: data.bank?.subscriptions?.news ?? [],
    rotina: mia.rotina,
    seen: await loadSeen(db),
    mia: mia.on,
  });
