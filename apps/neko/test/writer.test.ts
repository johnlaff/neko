import { type CardConfig, cents, localDate, type Placement, placeEntry } from "@neko/engine";
import { type ApiCell, SHEET_MAP } from "@neko/sheet-reader";
import { describe, expect, it } from "vitest";
import {
  commitEntry,
  fingerprint,
  locate,
  previewEntry,
  type SheetsApi,
  undoEntry,
} from "../src/worker/writer.ts";
import { sqliteD1 } from "./d1.ts";

type Entered = NonNullable<ApiCell["userEnteredValue"]>;
interface FakeCell {
  value: Entered;
  note: string;
}

/** `=SUM(1200+150,5)` in the sheet's dialect, evaluated like Sheets would. */
const evaluate = (v: Entered): number => {
  if (v.numberValue !== undefined) return v.numberValue;
  const inner = /^=SUM\((.*)\)$/s.exec(v.formulaValue ?? "")?.[1];
  if (inner === undefined) return 0;
  return inner
    .split("+")
    .map((t) => t.trim())
    .filter((t) => t !== "")
    .reduce((a, t) => a + Number(t.replace(",", ".")), 0);
};

/**
 * A year tab in memory: Data holds the day, Saldo is 1000 + Entrada − Saída − Diário of the row
 * (enough to see one write move it), and hooks let a test break the sheet on purpose.
 */
const fakeSheet = () => {
  const cells = new Map<string, FakeCell>();
  const key = (tab: string, row: number, col: number) => `${tab}:${row}:${col}`;
  const writes: string[] = [];
  const hooks = {
    failWrite: (_k: string): string | null => null,
    mangle: (_k: string, c: FakeCell): FakeCell => c,
  };
  const at = (tab: string, row: number, col: number): ApiCell => {
    const offset = col % SHEET_MAP.blockWidth;
    if (offset === SHEET_MAP.offsets.data)
      return { effectiveValue: { numberValue: row - SHEET_MAP.firstDayRow + 1 } };
    if (offset === SHEET_MAP.offsets.saldo) {
      const block = col - offset;
      const v = (o: number) => evaluate(cells.get(key(tab, row, block + o))?.value ?? {});
      const { entrada, saida, diario } = SHEET_MAP.offsets;
      return { effectiveValue: { numberValue: 1000 + v(entrada) - v(saida) - v(diario) } };
    }
    const c = cells.get(key(tab, row, col));
    if (!c) return {};
    const out: ApiCell = Object.keys(c.value).length > 0 ? { userEnteredValue: c.value } : {};
    if (c.value.formulaValue !== undefined || c.value.numberValue !== undefined)
      out.effectiveValue = { numberValue: evaluate(c.value) };
    if (c.note !== "") out.note = c.note;
    return out;
  };
  const api: SheetsApi = {
    async readRow(tab, row, firstCol) {
      return {
        sheetId: Number(tab),
        cells: [0, 1, 2, 3, 4].map((i) => at(tab, row, firstCol + i)),
      };
    },
    async writeCell(sheetId, row, col, value, note) {
      const k = key(String(sheetId), row, col);
      const fail = hooks.failWrite(k);
      if (fail) throw new Error(fail);
      writes.push(k);
      cells.set(k, hooks.mangle(k, { value, note }));
    },
  };
  const set = (p: Pick<Placement, "date" | "column">, value: Entered, note: string) => {
    const l = locate(p);
    cells.set(key(l.tab, l.row, l.col), { value, note });
  };
  const get = (p: Pick<Placement, "date" | "column">) => {
    const l = locate(p);
    return at(l.tab, l.row, l.col);
  };
  return {
    api,
    set,
    get,
    writes,
    hooks,
    key: (p: Pick<Placement, "date" | "column">) => {
      const l = locate(p);
      return key(l.tab, l.row, l.col);
    },
  };
};

const d = localDate;
const cards: CardConfig[] = [
  { name: "Cartão A", closingDay: 29, dueDay: 10, closingEstimated: false },
];
const fixedNow = () => "2026-10-09T03:00:00.000Z";

const setup = () => {
  const sheet = fakeSheet();
  sheet.set(
    { date: d("2026-01-01"), column: "entrada" },
    { formulaValue: "=SUM(1000)" },
    "R$ 1.000,00 - Saldo inicial",
  );
  return { sheet, db: sqliteD1() as unknown as D1Database };
};

const write = async (db: D1Database, api: SheetsApi, id: string, placements: Placement[]) => {
  const preview = await previewEntry(api, placements);
  return commitEntry(
    db,
    api,
    id,
    placements,
    preview.map((p) => p.fingerprint),
    fixedNow,
  );
};

describe("entry writer", () => {
  it("previews without writing, then writes the cell exactly as planned", async () => {
    const { sheet, db } = setup();
    const placements = placeEntry(
      { kind: "diario", amount: cents(4240), description: "Restaurante", date: d("2026-10-09") },
      cards,
    );
    const preview = await previewEntry(sheet.api, placements);
    expect(preview).toMatchObject([
      { address: "2026!BF11", before: 0, after: 4240, formula: "=SUM(42,4)" },
    ]);
    expect(sheet.writes).toEqual([]);

    const r = await commitEntry(
      db,
      sheet.api,
      "e1",
      placements,
      [preview[0]?.fingerprint ?? ""],
      fixedNow,
    );
    expect(r).toEqual({
      entryId: "e1",
      state: "done",
      parts: [{ address: "2026!BF11", before: 0, after: 4240, state: "done" }],
    });
    expect(sheet.get(placements[0] as Placement)).toMatchObject({
      userEnteredValue: { formulaValue: "=SUM(42,4)" },
      note: "R$ 42,40 - Restaurante",
    });
  });

  it("writes once when the same entry is sent twice", async () => {
    const { sheet, db } = setup();
    const ps = placeEntry(
      { kind: "entrada", amount: cents(100), description: "Pix", date: d("2026-10-20") },
      cards,
    );
    const first = await write(db, sheet.api, "same", ps);
    const again = await write(db, sheet.api, "same", ps);
    expect(again).toEqual(first);
    expect(sheet.writes).toHaveLength(1);
  });

  it("refuses when the cell changed after the preview, and writes nothing", async () => {
    const { sheet, db } = setup();
    const ps = placeEntry(
      { kind: "conta", amount: cents(5000), description: "Luz", date: d("2026-10-10") },
      cards,
    );
    const preview = await previewEntry(sheet.api, ps);
    sheet.set(ps[0] as Placement, { formulaValue: "=SUM(10)" }, "R$ 10,00 - Água");
    await expect(
      commitEntry(
        db,
        sheet.api,
        "e",
        ps,
        preview.map((p) => p.fingerprint),
        fixedNow,
      ),
    ).rejects.toThrow(/mudou desde a prévia/);
    expect(sheet.writes).toEqual([]);
  });

  it("refuses a cell it does not fully understand, naming the address", async () => {
    const { sheet } = setup();
    const ps = placeEntry(
      { kind: "diario", amount: cents(100), description: "x", date: d("2026-10-09") },
      cards,
    );
    sheet.set(ps[0] as Placement, { formulaValue: "=A1*2" }, "");
    await expect(previewEntry(sheet.api, ps)).rejects.toThrow(/2026!BF11: a fórmula/);
  });

  it("lands a card purchase in installments whole or not at all", async () => {
    const { sheet, db } = setup();
    const ps = placeEntry(
      {
        kind: "cartao",
        amount: cents(30000),
        description: "Fone",
        date: d("2026-10-09"),
        card: "Cartão A",
        installments: 3,
      },
      cards,
    );
    expect(ps.map((p) => p.date)).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
    // The third bill is in tab 2027, which refuses the write like a protected range would.
    const third = sheet.key(ps[2] as Placement);
    sheet.hooks.failWrite = (k) => (k === third ? "403 protegido" : null);
    const before = ps.map((p) => sheet.get(p));
    const r = await write(db, sheet.api, "fone", ps);
    expect(r.state).toBe("failed");
    expect(r.parts.map((p) => p.state)).toEqual(["undone", "undone", "failed"]);
    expect(ps.map((p) => sheet.get(p))).toEqual(before);
  });

  it("puts the cell back when the sheet does not show what was written", async () => {
    const { sheet, db } = setup();
    const ps = placeEntry(
      { kind: "entrada", amount: cents(100), description: "Pix", date: d("2026-10-20") },
      cards,
    );
    let once = true;
    sheet.hooks.mangle = (_k, c) => {
      if (!once) return c;
      once = false;
      return { ...c, note: `${c.note}\nlixo` };
    };
    const r = await write(db, sheet.api, "m", ps);
    expect(r.state).toBe("failed");
    expect(sheet.get(ps[0] as Placement)).toEqual({});
  });

  it("undoes an entry, and refuses once the owner changed the cell", async () => {
    const { sheet, db } = setup();
    sheet.set(
      { date: d("2026-10-10"), column: "saida" },
      { formulaValue: "=SUM(1200)" },
      "CONTAS\nR$ 1.200,00 - Aluguel",
    );
    const ps = placeEntry(
      { kind: "conta", amount: cents(15050), description: "Luz", date: d("2026-10-10") },
      cards,
    );
    const before = sheet.get(ps[0] as Placement);
    await write(db, sheet.api, "luz", ps);
    expect(sheet.get(ps[0] as Placement).note).toBe(
      "CONTAS\nR$ 1.200,00 - Aluguel\nR$ 150,50 - Luz",
    );
    expect((await undoEntry(db, sheet.api, "luz", fixedNow)).state).toBe("undone");
    expect(sheet.get(ps[0] as Placement)).toEqual(before);

    await write(db, sheet.api, "luz2", ps);
    sheet.set(ps[0] as Placement, { formulaValue: "=SUM(1)" }, "R$ 1,00 - Outra coisa");
    await expect(undoEntry(db, sheet.api, "luz2", fixedNow)).rejects.toThrow(/mudou depois/);
  });

  it("finishes an entry interrupted after the cell was written", async () => {
    const { sheet, db } = setup();
    const ps = placeEntry(
      { kind: "entrada", amount: cents(100), description: "Pix", date: d("2026-10-20") },
      cards,
    );
    const preview = await previewEntry(sheet.api, ps);
    await commitEntry(
      db,
      sheet.api,
      "x",
      ps,
      preview.map((p) => p.fingerprint),
      fixedNow,
    );
    // Pretend the Worker died before marking it done.
    await db.prepare("UPDATE entry_op SET state = 'writing' WHERE entry_id = 'x'").run();
    const r = await commitEntry(
      db,
      sheet.api,
      "x",
      ps,
      preview.map((p) => p.fingerprint),
      fixedNow,
    );
    expect(r.state).toBe("done");
    expect(sheet.writes).toHaveLength(1);
  });

  it("hands out the same fingerprint for the same cell and a new one when it changes", async () => {
    const a = await fingerprint({
      userEnteredValue: { formulaValue: "=SUM(1)" },
      note: "R$ 1,00 - x",
    });
    const b = await fingerprint({
      userEnteredValue: { formulaValue: "=SUM(1)" },
      note: "R$ 1,00 - x",
    });
    const c = await fingerprint({
      userEnteredValue: { formulaValue: "=SUM(2)" },
      note: "R$ 1,00 - x",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
