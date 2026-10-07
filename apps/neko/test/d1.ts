import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

/**
 * A real SQLite database behind the slice of the D1 API the Worker uses, with every migration
 * applied: the statements under test run as written, not against a hand-rolled fake.
 */
export const sqliteD1 = () => {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  const statement = (sql: string, args: SQLInputValue[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next as SQLInputValue[]),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes) } };
    },
    first: async <T>() => (db.prepare(sql).get(...args) as T | undefined) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...args) as T[] }),
  });
  return {
    sqlite: db,
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: { run: () => Promise<unknown> }[]) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
};
