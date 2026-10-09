import {
  addDays,
  type CardConfig,
  cents,
  localDate,
  type Placement,
  placeEntry,
} from "@neko/engine";
import { type ApiCell, SHEET_MAP } from "@neko/sheet-reader";
import { describe, expect, it } from "vitest";
import {
  commitEntry,
  fingerprint,
  googleSheets,
  locate,
  previewEntry,
  type SheetsApi,
  undoEntry,
  writeForecast,
} from "../src/worker/writer.ts";
import { sqliteD1 } from "./d1.ts";

type Entered = NonNullable<ApiCell["userEnteredValue"]>;
interface FakeCell {
  value: Entered;
  note: string;
}

/** `=SUM(1200+150,5)` or `=500-300` in the sheet's dialect, evaluated like Sheets would. */
const evaluate = (v: Entered): number => {
  if (v.numberValue !== undefined) return v.numberValue;
  const f = v.formulaValue ?? "";
  const inner = /^=SUM\((.*)\)$/s.exec(f)?.[1] ?? f.slice(1);
  return [...inner.matchAll(/([-+]?)\s*([\d,]+)/g)].reduce(
    (a, [, sign, n]) => a + (sign === "-" ? -1 : 1) * Number((n ?? "").replace(",", ".")),
    0,
  );
};

/** The Economia tab's sheetId in the fake; year tabs use their year. */
const ECONOMIA = 9;
/** Its 2026 block: year in column G of row 4, Economia in column I, jan on row 5. */
const economiaGrid = (cellAt: (row: number, col: number) => ApiCell): ApiCell[][] => {
  const t = (s: string): ApiCell => ({ effectiveValue: { stringValue: s } });
  const months = "jan fev mar abr mai jun jul ago set out nov dez".split(" ");
  return Array.from({ length: 20 }, (_, row) =>
    Array.from({ length: 11 }, (_, col) => {
      if (row === 3 && col === 6) return { effectiveValue: { numberValue: 2026 } };
      if (row === 3 && col === 7) return t("Entradas");
      if (row === 3 && col === 8) return t("Economia");
      if (row >= 4 && row < 16 && col === 6) return t(months[row - 4] ?? "");
      return cellAt(row, col);
    }),
  );
};

/**
 * A year tab in memory: Data holds the day, Saldo carries like the sheet's (1000, then each day's
 * Entrada − Saída − Diário, month after month), and hooks let a test break the sheet on purpose.
 */
const fakeSheet = () => {
  const cells = new Map<string, FakeCell>();
  const key = (tab: string, row: number, col: number) => `${tab}:${row}:${col}`;
  const writes: string[] = [];
  const batches: number[] = [];
  const hooks = {
    failWrite: (_k: string): string | null => null,
    mangle: (_k: string, c: FakeCell): FakeCell => c,
  };
  const at = (tab: string, row: number, col: number): ApiCell => {
    const offset = tab === String(ECONOMIA) ? -1 : col % SHEET_MAP.blockWidth;
    if (offset === SHEET_MAP.offsets.data)
      return { effectiveValue: { numberValue: row - SHEET_MAP.firstDayRow + 1 } };
    if (offset === SHEET_MAP.offsets.saldo) {
      const v = (r: number, c: number) => evaluate(cells.get(key(tab, r, c))?.value ?? {});
      const { entrada, saida, diario } = SHEET_MAP.offsets;
      let saldo = 1000;
      for (let block = 0; block <= col - offset; block += SHEET_MAP.blockWidth)
        for (let r = SHEET_MAP.firstDayRow; r <= (block === col - offset ? row : 32); r++)
          saldo += v(r, block + entrada) - v(r, block + saida) - v(r, block + diario);
      return { effectiveValue: { numberValue: Math.round(saldo * 100) / 100 } };
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
    async readEconomia() {
      return { sheetId: ECONOMIA, rows: economiaGrid((r, c) => at(String(ECONOMIA), r, c)) };
    },
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
    async readDays(tab) {
      return {
        sheetId: Number(tab),
        rows: Array.from({ length: 31 }, (_, r) =>
          Array.from({ length: 72 }, (_, c) => at(tab, SHEET_MAP.firstDayRow + r, c)),
        ),
      };
    },
    async writeCells(sheetId, list) {
      const fail = list
        .map((c) => hooks.failWrite(key(String(sheetId), c.row, c.col)))
        .find(Boolean);
      if (fail) throw new Error(fail);
      batches.push(list.length);
      for (const c of list) {
        const k = key(String(sheetId), c.row, c.col);
        writes.push(k);
        cells.set(k, hooks.mangle(k, { value: c.value, note: c.note }));
      }
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
    batches,
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
    ).rejects.toThrow(/mudou na planilha agora há pouco/);
    expect(sheet.writes).toEqual([]);
  });

  it("refuses a cell it does not fully understand, naming the day", async () => {
    const { sheet } = setup();
    const ps = placeEntry(
      { kind: "diario", amount: cents(100), description: "x", date: d("2026-10-09") },
      cards,
    );
    sheet.set(ps[0] as Placement, { formulaValue: "=A1*2" }, "");
    await expect(previewEntry(sheet.api, ps)).rejects.toThrow(
      /mudar o Diário de 09\/10: a fórmula/,
    );
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

  it("moves a planned line to another day and changes its value, undoing both", async () => {
    const { sheet, db } = setup();
    const from = { date: d("2026-11-05"), column: "entrada" } as const;
    const to = { date: d("2026-11-04"), column: "entrada" } as const;
    sheet.set(
      from,
      { formulaValue: "=SUM(9000+50)" },
      "R$ 9.000,00 - Salário\nR$ 50,00 - Rendimento",
    );
    const before = [sheet.get(from), sheet.get(to)];
    const move: Placement[] = [
      {
        ...from,
        section: null,
        description: "Salário",
        target: "line",
        was: cents(900000),
        amount: cents(0),
      },
      { ...to, section: null, description: "Salário", target: "line", amount: cents(912345) },
    ];
    const preview = await previewEntry(sheet.api, move);
    expect(preview.map((p) => [p.before, p.after])).toEqual([
      [905000, 5000],
      [0, 912345],
    ]);
    expect((await write(db, sheet.api, "mv", move)).state).toBe("done");
    expect(sheet.get(from)).toMatchObject({ note: "R$ 50,00 - Rendimento" });
    expect(sheet.get(to)).toMatchObject({ note: "R$ 9.123,45 - Salário" });

    expect((await undoEntry(db, sheet.api, "mv", fixedNow)).state).toBe("undone");
    expect([sheet.get(from), sheet.get(to)]).toEqual(before);
  });

  it("empties a cell whose last line is removed", async () => {
    const { sheet, db } = setup();
    const at = { date: d("2026-10-12"), column: "diario" } as const;
    sheet.set(at, { formulaValue: "=SUM(42,4)" }, "R$ 42,40 - Padaria");
    const r = await write(db, sheet.api, "rm", [
      {
        ...at,
        section: null,
        description: "Padaria",
        target: "line",
        was: cents(4240),
        amount: cents(0),
      },
    ]);
    expect(r.parts).toEqual([{ address: "2026!BF14", before: 4240, after: 0, state: "done" }]);
    expect(sheet.get(at)).toEqual({});
  });

  it("saves into the reserve and adds it to the month's Economia, undoing both", async () => {
    const { sheet, db } = setup();
    const economia = (row: number) => sheet.api.readEconomia().then((e) => e.rows[row]?.[8]);
    const ps = placeEntry(
      { kind: "reserva", amount: cents(50000), description: "Reserva", date: d("2026-10-15") },
      cards,
    );
    const preview = await previewEntry(sheet.api, ps);
    expect(preview.map((p) => [p.address, p.before, p.after, p.formula])).toEqual([
      ["2026!BE17", 0, 50000, "=SUM(500)"],
      ["Economia!I14", 0, 50000, "=500"],
    ]);
    const r = await write(db, sheet.api, "guardou", ps);
    expect(r.state).toBe("done");
    expect(await economia(13)).toMatchObject({ userEnteredValue: { formulaValue: "=500" } });

    const resgate = placeEntry(
      { kind: "resgate", amount: cents(30000), description: "Reserva", date: d("2026-10-20") },
      cards,
    );
    expect((await write(db, sheet.api, "resgatou", resgate)).state).toBe("done");
    expect(await economia(13)).toMatchObject({
      userEnteredValue: { formulaValue: "=500-300" },
      effectiveValue: { numberValue: 200 },
    });

    expect((await undoEntry(db, sheet.api, "resgatou", fixedNow)).state).toBe("undone");
    expect((await undoEntry(db, sheet.api, "guardou", fixedNow)).state).toBe("undone");
    expect(await economia(13)).toEqual({});
    expect(sheet.get(ps[0] as Placement)).toEqual({});
  });

  it("writes neither the reserve line nor the Economia when the Economia cell fails", async () => {
    const { sheet, db } = setup();
    sheet.hooks.failWrite = (k) => (k.startsWith("9:") ? "sem permissão" : null);
    const ps = placeEntry(
      { kind: "reserva", amount: cents(100), description: "Reserva", date: d("2026-10-15") },
      cards,
    );
    const r = await write(db, sheet.api, "e", ps);
    expect(r.state).toBe("failed");
    expect(r.error).toMatch(/sem permissão/);
    expect(sheet.get(ps[0] as Placement)).toEqual({});
  });

  it("refuses an Economia cell that is not a plain sum, and a year without a block", async () => {
    const { sheet } = setup();
    const reserva = (date: string) =>
      placeEntry(
        { kind: "reserva", amount: cents(100), description: "Reserva", date: d(date) },
        cards,
      );
    await expect(previewEntry(sheet.api, reserva("2027-01-05"))).rejects.toThrow(
      /Economia não tem o bloco de 2027/,
    );
    await sheet.api.writeCell(9, 13, 8, { formulaValue: "=H14*0,1" }, "");
    await expect(previewEntry(sheet.api, reserva("2026-10-05"))).rejects.toThrow(
      /não consegue mudar a Economia de 10\/2026: a fórmula não é só de somas/,
    );
  });

  it("waits and retries when Google says the minute's quota is spent", async () => {
    const answers = [429, 429, 200];
    const waits: number[] = [];
    const f = (async () => {
      const status = answers.shift() ?? 200;
      return new Response(
        JSON.stringify({ sheets: [{ properties: { sheetId: 7 }, data: [{ rowData: [] }] }] }),
        { status },
      );
    }) as typeof fetch;
    const api = googleSheets("id", "token", f, async (ms) => {
      waits.push(ms);
    });
    expect((await api.readRow("2026", 2, 0)).sheetId).toBe(7);
    expect(waits).toEqual([1000, 2000]);
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

describe("Diário previsto writer", () => {
  const span = (from: string, to: string) => {
    const out = [];
    for (let x = d(from); x <= d(to); x = addDays(x, 1)) out.push(x);
    return out;
  };
  const diario = (date: string) => ({ date: d(date), column: "diario" as const });

  it("fills the days ahead tab by tab, in one write each, leaving what the owner wrote", async () => {
    const { sheet, db } = setup();
    sheet.set(diario("2026-12-30"), { numberValue: 0 }, "");
    sheet.set(diario("2026-12-31"), { formulaValue: "=SUM(12)" }, "R$ 12,00 - Café");
    const r = await writeForecast(
      db,
      sheet.api,
      "f1",
      span("2026-12-29", "2027-01-02"),
      cents(4500),
      fixedNow,
    );
    expect(r.state).toBe("done");
    expect(r.parts).toHaveLength(4);
    expect(sheet.batches).toEqual([2, 2]);
    expect(sheet.get(diario("2026-12-30"))).toMatchObject({
      userEnteredValue: { formulaValue: "=SUM(45)" },
      note: "R$ 45,00 - Previsto",
    });
    expect(sheet.get(diario("2026-12-31")).note).toBe("R$ 12,00 - Café");
    expect(sheet.get(diario("2027-01-02")).note).toBe("R$ 45,00 - Previsto");
  });

  it("changes only its own forecast, and takes it away with 0, the owner's lines staying", async () => {
    const { sheet, db } = setup();
    await writeForecast(
      db,
      sheet.api,
      "f1",
      span("2026-11-01", "2026-11-03"),
      cents(4500),
      fixedNow,
    );
    sheet.set(
      diario("2026-11-02"),
      { formulaValue: "=SUM(45+12)" },
      "R$ 45,00 - Previsto\nR$ 12,00 - Café",
    );
    await writeForecast(
      db,
      sheet.api,
      "f2",
      span("2026-11-01", "2026-11-03"),
      cents(5000),
      fixedNow,
    );
    expect(sheet.get(diario("2026-11-01")).note).toBe("R$ 50,00 - Previsto");
    expect(sheet.get(diario("2026-11-02")).note).toBe("R$ 45,00 - Previsto\nR$ 12,00 - Café");
    const off = await writeForecast(
      db,
      sheet.api,
      "f3",
      span("2026-11-01", "2026-11-03"),
      cents(0),
      fixedNow,
    );
    expect(off.parts.map((p) => [p.before, p.after])).toEqual([
      [5000, 0],
      [5700, 1200],
      [5000, 0],
    ]);
    expect(sheet.get(diario("2026-11-01"))).toEqual({});
    expect(sheet.get(diario("2026-11-02")).note).toBe("R$ 12,00 - Café");
  });

  it("puts every tab back when one day does not read back as written", async () => {
    const { sheet, db } = setup();
    let once = true;
    sheet.hooks.mangle = (k, c) => {
      if (!once || k !== sheet.key(diario("2027-01-02"))) return c;
      once = false;
      return { ...c, note: "x" };
    };
    const r = await writeForecast(
      db,
      sheet.api,
      "f1",
      span("2026-12-30", "2027-01-02"),
      cents(4500),
      fixedNow,
    );
    expect(r.state).toBe("failed");
    for (const day of span("2026-12-30", "2027-01-02")) expect(sheet.get(diario(day))).toEqual({});
  });

  it("undoes the whole forecast at once, and refuses once the owner changed a day", async () => {
    const { sheet, db } = setup();
    await writeForecast(
      db,
      sheet.api,
      "f1",
      span("2026-11-01", "2026-11-05"),
      cents(4500),
      fixedNow,
    );
    expect((await undoEntry(db, sheet.api, "f1", fixedNow)).state).toBe("undone");
    expect(sheet.get(diario("2026-11-03"))).toEqual({});
    await writeForecast(
      db,
      sheet.api,
      "f2",
      span("2026-11-01", "2026-11-05"),
      cents(4500),
      fixedNow,
    );
    sheet.set(diario("2026-11-04"), { formulaValue: "=SUM(9)" }, "R$ 9,00 - Pão");
    await expect(undoEntry(db, sheet.api, "f2", fixedNow)).rejects.toThrow(/mudou depois/);
  });

  it("writes a Pix on a forecast day in place of the forecast", async () => {
    const { sheet, db } = setup();
    await writeForecast(db, sheet.api, "f1", [d("2026-11-03")], cents(4500), fixedNow);
    const r = await write(
      db,
      sheet.api,
      "p1",
      placeEntry(
        { kind: "diario", amount: cents(3000), description: "Feira", date: d("2026-11-03") },
        cards,
      ),
    );
    expect(r.parts).toEqual([
      expect.objectContaining({ before: 4500, after: 3000, state: "done" }),
    ]);
    expect(sheet.get(diario("2026-11-03")).note).toBe("R$ 30,00 - Feira");
  });
});
