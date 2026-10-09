import { randomUUID } from "node:crypto";
import { cents, fromReais, localDate, type Placement } from "@neko/engine";
import { SHEET_MAP } from "@neko/sheet-reader";
import { describe, expect, it } from "vitest";
import { accessToken, WRITE_SCOPES } from "../src/worker/google.ts";
import {
  commitEntry,
  googleSheets,
  locate,
  previewEntry,
  type SheetsApi,
  undoEntry,
} from "../src/worker/writer.ts";
import { sqliteD1 } from "./d1.ts";

/**
 * The writer against Google itself (specs/005-lancamentos, Fase 1), on the "Neko Teste" sheet:
 * same structure as the owner's, pt-BR locale, invented values, protected like the real one.
 * Runs only where both secrets exist (CI on this repository). Every test undoes what it wrote,
 * and asserts changes relative to what it found, so a run that died halfway does not break the
 * next one.
 */
const key = process.env.NEKO_WRITER_SERVICE_ACCOUNT_JSON ?? "";
const sheetId = process.env.NEKO_TEST_SHEET_ID ?? "";
const available = key !== "" && sheetId !== "";

const d = localDate;
const at = (date: string, column: Placement["column"]) => ({ date: d(date), column });

describe.runIf(available)("writer on the test sheet", { timeout: 60_000 }, () => {
  let api: SheetsApi;
  const sheets = async () => {
    api ??= googleSheets(sheetId, await accessToken(key, Date.now(), WRITE_SCOPES));
    return api;
  };
  const read = async (p: ReturnType<typeof at>) => {
    const l = locate(p);
    const { cells } = await (await sheets()).readRow(l.tab, l.row, l.block);
    return {
      cell: cells[SHEET_MAP.offsets[p.column]] ?? {},
      saldo: fromReais(cells[SHEET_MAP.offsets.saldo]?.effectiveValue?.numberValue ?? Number.NaN),
    };
  };
  const roundTrip = async (placement: Placement, expectNote: (before: string) => string) => {
    const s = await sheets();
    const db = sqliteD1() as unknown as D1Database;
    const id = randomUUID();
    const before = await read(placement);
    const [preview] = await previewEntry(s, [placement]);
    if (!preview) throw new Error("no preview");

    const done = await commitEntry(db, s, id, [placement], [preview.fingerprint]);
    expect(done.state, JSON.stringify(done)).toBe("done");
    const after = await read(placement);
    // The formula reads back exactly as written: the pt-BR dialect round-trips through the API.
    expect(after.cell.userEnteredValue?.formulaValue).toBe(preview.formula);
    expect(fromReais(after.cell.effectiveValue?.numberValue ?? 0)).toBe(preview.after);
    expect(after.cell.note).toBe(expectNote(before.cell.note ?? ""));
    const sign = placement.column === "entrada" ? 1 : -1;
    expect(after.saldo - before.saldo).toBe(sign * placement.amount);

    expect((await undoEntry(db, s, id)).state).toBe("undone");
    const undone = await read(placement);
    expect(undone.cell.userEnteredValue).toEqual(before.cell.userEnteredValue);
    expect(undone.cell.note ?? "").toBe(before.cell.note ?? "");
    expect(undone.saldo).toBe(before.saldo);
  };

  it("adds a Diário expense to a day with nothing spent, and undoes it", async () => {
    await roundTrip(
      {
        ...at("2026-03-20", "diario"),
        section: null,
        amount: cents(1234),
        description: "Padaria",
        target: "line",
      },
      () => "R$ 12,34 - Padaria",
    );
  });

  it("adds an income line below the salary on an Entrada", async () => {
    await roundTrip(
      {
        ...at("2026-04-05", "entrada"),
        section: null,
        amount: cents(5050),
        description: "Reembolso",
        target: "line",
      },
      (b) => `${b}\nR$ 50,50 - Reembolso`,
    );
  });

  it("adds a bill under CONTAS of a Saída that also has cards", async () => {
    await roundTrip(
      {
        ...at("2026-05-10", "saida"),
        section: "contas",
        amount: cents(9999),
        description: "Internet",
        target: "line",
      },
      (b) => b.replace("R$ 150,50 - Luz", "R$ 150,50 - Luz\nR$ 99,99 - Internet"),
    );
  });

  it("raises a card's line on its bill", async () => {
    await roundTrip(
      {
        ...at("2026-06-10", "saida"),
        section: "cartoes",
        amount: cents(4240),
        description: "Cartão A",
        target: "card",
      },
      (b) => b.replace("R$ 300,00 - Cartão A", "R$ 342,40 - Cartão A"),
    );
  });

  it("fills an empty bill (R$ 0,00) of a card", async () => {
    await roundTrip(
      {
        ...at("2026-07-15", "saida"),
        section: "cartoes",
        amount: cents(1990),
        description: "Cartão B",
        target: "card",
      },
      (b) => b.replace("R$ 0,00 - Cartão B", "R$ 19,90 - Cartão B"),
    );
  });

  /** Several cells at once (a move), each checked against its own preview, then undone. */
  const roundTripMany = async (placements: Placement[], expectNotes: ((b: string) => string)[]) => {
    const s = await sheets();
    const db = sqliteD1() as unknown as D1Database;
    const id = randomUUID();
    const before = await Promise.all(placements.map(read));
    const preview = await previewEntry(s, placements);
    const done = await commitEntry(
      db,
      s,
      id,
      placements,
      preview.map((p) => p.fingerprint),
    );
    expect(done.state, JSON.stringify(done)).toBe("done");
    for (const [i, p] of placements.entries()) {
      const after = await read(p);
      const plan = preview[i];
      expect(after.cell.userEnteredValue?.formulaValue).toBe(plan?.formula || undefined);
      expect(after.cell.note ?? "").toBe(expectNotes[i]?.(before[i]?.cell.note ?? ""));
      const sign = p.column === "entrada" ? 1 : -1;
      expect(after.saldo - (before[i]?.saldo ?? 0)).toBe(
        sign * ((plan?.after ?? 0) - (plan?.before ?? 0)),
      );
    }
    expect((await undoEntry(db, s, id)).state).toBe("undone");
    for (const [i, p] of placements.entries()) {
      const undone = await read(p);
      expect(undone.cell.userEnteredValue).toEqual(before[i]?.cell.userEnteredValue);
      expect(undone.cell.note ?? "").toBe(before[i]?.cell.note ?? "");
    }
  };

  it("changes the value of a planned salary", async () => {
    await roundTripMany(
      [
        {
          ...at("2026-02-05", "entrada"),
          section: null,
          description: "Salário",
          target: "line",
          was: cents(400000),
          amount: cents(412345),
        },
      ],
      [(b) => b.replace("R$ 4.000,00 - Salário", "R$ 4.123,45 - Salário")],
    );
  });

  it("removes a bill line from CONTAS", async () => {
    await roundTripMany(
      [
        {
          ...at("2026-03-10", "saida"),
          section: "contas",
          description: "Luz",
          target: "line",
          was: cents(15050),
          amount: cents(0),
        },
      ],
      [(b) => b.replace("R$ 150,50 - Luz\n", "")],
    );
  });

  it("moves the salary to the day before, emptying its old cell", async () => {
    const line = { section: null, description: "Salário", target: "line" } as const;
    await roundTripMany(
      [
        { ...at("2026-01-05", "entrada"), ...line, was: cents(400000), amount: cents(0) },
        { ...at("2026-01-04", "entrada"), ...line, amount: cents(400000) },
      ],
      [() => "", () => "R$ 4.000,00 - Salário"],
    );
  });

  it("sets a card's line on its bill to a lower total", async () => {
    await roundTripMany(
      [
        {
          ...at("2026-09-10", "saida"),
          section: "cartoes",
          description: "Cartão A",
          target: "card",
          was: cents(30000),
          amount: cents(29999),
        },
      ],
      [(b) => b.replace("R$ 300,00 - Cartão A", "R$ 299,99 - Cartão A")],
    );
  });

  it("refuses to write when the cell changed after the preview", async () => {
    const s = await sheets();
    const p: Placement = {
      ...at("2026-08-21", "diario"),
      section: null,
      amount: cents(100),
      description: "Café",
      target: "line",
    };
    const l = locate(p);
    const before = await read(p);
    const [preview] = await previewEntry(s, [p]);
    const { sheetId: tabId } = await s.readRow(l.tab, l.row, l.block);
    await s.writeCell(tabId, l.row, l.col, { formulaValue: "=SUM(2)" }, "R$ 2,00 - Outra pessoa");
    try {
      await expect(
        commitEntry(
          sqliteD1() as unknown as D1Database,
          s,
          randomUUID(),
          [p],
          [preview?.fingerprint ?? ""],
        ),
      ).rejects.toThrow(/mudou desde a prévia/);
    } finally {
      await s.writeCell(
        tabId,
        l.row,
        l.col,
        before.cell.userEnteredValue ?? {},
        before.cell.note ?? "",
      );
    }
  });

  it("cannot touch Data or Saldo: the sheet protects them from Neko's account", async () => {
    const s = await sheets();
    const l = locate(at("2026-09-09", "diario"));
    const { sheetId: tabId } = await s.readRow(l.tab, l.row, l.block);
    for (const col of [l.block + SHEET_MAP.offsets.data, l.block + SHEET_MAP.offsets.saldo])
      await expect(s.writeCell(tabId, l.row, col, { numberValue: 1 }, "")).rejects.toThrow(
        /403|protect/i,
      );
  });
});
