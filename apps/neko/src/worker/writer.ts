import {
  type Cents,
  cents,
  dropsForecast,
  FORECAST,
  fromReais,
  isForecastItem,
  type LocalDate,
  type Placement,
  parts,
} from "@neko/engine";
import {
  type ApiCell,
  a1,
  checkCell,
  checkEconomia,
  type EditOp,
  parseNote,
  planCellEdit,
  planEconomiaEdit,
  SHEET_MAP,
} from "@neko/sheet-reader";
import { z } from "zod";

/**
 * Writes entries into the sheet (specs/005-lancamentos). Each placement adds, changes or removes
 * one line of an Entrada/Saída/Diário cell exactly as the owner would type it, or a month's cell of
 * the Economia tab when money goes into or out of the reserve. The Sheets API has no
 * compare-and-set and cannot restore a revision, so safety lives here:
 * - the cells are re-read right before writing and must still be the ones the preview showed;
 * - the journal rows (D1 `entry_op`) are written first, with the cells as they were;
 * - every cell of an entry goes in one batchUpdate, which Google applies whole or not at all;
 * - after writing, the cells and the days' Saldo (the Economia tab has none) are read back and
 *   must have changed by exactly the amounts, or every cell is put back;
 * - undo restores the stored cells, only if they are still as Neko left them.
 * The reads of an entry go out together, so a launch costs three round trips to Google, not three
 * per cell. Callers run one write at a time (a single writer), so the Saldo check sees only this
 * change.
 */

/** What the API returns for a cell's `userEnteredValue`; an empty cell has none. */
type EnteredValue = NonNullable<ApiCell["userEnteredValue"]>;

/** The slice of the Sheets API the writer uses, so tests can run it against a fake sheet. */
export interface SheetsApi {
  /** The five cells Data, Entrada, Saída, Diário and Saldo of one day row of a year tab. */
  readRow(
    tab: string,
    row: number,
    firstCol: number,
  ): Promise<{ sheetId: number; cells: ApiCell[] }>;
  /** The Economia tab's cells A1:Z20, row by row. */
  readEconomia(): Promise<{ sheetId: number; rows: ApiCell[][] }>;
  /** Sets one cell's value (formula, number or empty) and note, and nothing else. */
  writeCell(
    sheetId: number,
    row: number,
    col: number,
    value: EnteredValue,
    note: string,
  ): Promise<void>;
  /** Every day row of a year tab (31 rows from the first day, all 12 month blocks). */
  readDays(tab: string): Promise<{ sheetId: number; rows: ApiCell[][] }>;
  /** Sets many cells' values and notes, on any tabs, in one request: all of them change, or none. */
  writeCells(cells: readonly CellWrite[]): Promise<void>;
}

export interface CellWrite {
  readonly sheetId: number;
  readonly row: number;
  readonly col: number;
  readonly value: EnteredValue;
  readonly note: string;
}

/** One updateCells request: value and note of one cell, nothing else. */
const updateCells = ({ sheetId, row, col, value, note }: CellWrite) => ({
  updateCells: {
    range: {
      sheetId,
      startRowIndex: row,
      endRowIndex: row + 1,
      startColumnIndex: col,
      endColumnIndex: col + 1,
    },
    // An empty value with "userEnteredValue" in the mask clears the cell.
    rows: [
      { values: [Object.keys(value).length > 0 ? { userEnteredValue: value, note } : { note }] },
    ],
    fields: "userEnteredValue,note",
  },
});

export class WriteError extends Error {
  override name = "WriteError";
}

const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** "o Diário de 15/10", "a Economia de 10/2026": a place in the sheet as the owner calls it. */
const where = (column: Placement["column"], target: Placement["target"], date: string) =>
  target === "economia"
    ? `a Economia de ${date.slice(5, 7)}/${date.slice(0, 4)}`
    : `${{ entrada: "a Entrada", saida: "a Saída", diario: "o Diário" }[column]} de ${ddmm(date)}`;

const placeOf = (p: Placement) => where(p.column, p.target, p.date);
const placeOfOp = (o: OpRow) => where(o.column_name, o.target, o.date);

const ROW_FIELDS =
  "sheets(properties(sheetId),data(rowData(values(effectiveValue,userEnteredValue,note))))";

const RowResponse = z.object({
  sheets: z
    .array(
      z.object({
        properties: z.object({ sheetId: z.number() }),
        data: z
          .array(
            z.object({
              rowData: z.array(z.object({ values: z.array(z.unknown()).optional() })).optional(),
            }),
          )
          .optional(),
      }),
    )
    .min(1),
});

/** Tries after a 429, waiting 1, 2, 4, 8, 16, 32 and 60 seconds: two minutes in all. */
const RETRIES = 7;

/** The real Sheets API, with a token of the neko-writer account (`WRITE_SCOPES`). */
export const googleSheets = (
  spreadsheetId: string,
  token: string,
  f: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): SheetsApi => {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const call = async (url: string, init?: RequestInit) => {
    // Sheets allows 60 reads and 60 writes a minute: a busy minute answers 429, so wait and retry.
    for (let attempt = 0; ; attempt++) {
      const res = await f(url, {
        ...init,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      });
      if (res.status === 429 && attempt < RETRIES) {
        await res.body?.cancel();
        await wait(Math.min(60_000, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        console.error("sheets", res.status, body);
        // The sheet's protection (proteger-planilha.gs) keeps Neko out of Data, Saldo and the rest.
        if (body.includes("protected"))
          throw new WriteError("a planilha está protegida para o Neko nesse lugar");
        throw new WriteError(`o Google respondeu ${res.status} e não gravou`);
      }
      return res.json();
    }
  };
  return {
    async readRow(tab, row, firstCol) {
      const qs = new URLSearchParams({
        ranges: `'${tab}'!${a1(row, firstCol)}:${a1(row, firstCol + SHEET_MAP.offsets.saldo)}`,
        includeGridData: "true",
        fields: ROW_FIELDS,
      });
      const body = RowResponse.parse(await call(`${base}?${qs}`));
      const sheet = body.sheets[0];
      return {
        sheetId: sheet?.properties.sheetId ?? 0,
        cells: (sheet?.data?.[0]?.rowData?.[0]?.values ?? []) as ApiCell[],
      };
    },
    async readEconomia() {
      const qs = new URLSearchParams({
        ranges: `'${ECONOMIA_TAB}'!A1:Z20`,
        includeGridData: "true",
        fields: ROW_FIELDS,
      });
      const body = RowResponse.parse(await call(`${base}?${qs}`));
      const sheet = body.sheets[0];
      return {
        sheetId: sheet?.properties.sheetId ?? 0,
        rows: (sheet?.data?.[0]?.rowData ?? []).map((r) => (r.values ?? []) as ApiCell[]),
      };
    },
    async writeCell(sheetId, row, col, value, note) {
      // One updateCells request sets value and note together: either both change or neither.
      await call(`${base}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ requests: [updateCells({ sheetId, row, col, value, note })] }),
      });
    },
    async readDays(tab) {
      const first = SHEET_MAP.firstDayRow;
      const qs = new URLSearchParams({
        ranges: `'${tab}'!${a1(first, 0)}:${a1(first + 30, 12 * SHEET_MAP.blockWidth - 1)}`,
        includeGridData: "true",
        fields: ROW_FIELDS,
      });
      const body = RowResponse.parse(await call(`${base}?${qs}`));
      const sheet = body.sheets[0];
      return {
        sheetId: sheet?.properties.sheetId ?? 0,
        rows: (sheet?.data?.[0]?.rowData ?? []).map((r) => (r.values ?? []) as ApiCell[]),
      };
    },
    async writeCells(cells) {
      // A batchUpdate is all or nothing: one bad request and no cell changes.
      await call(`${base}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ requests: cells.map(updateCells) }),
      });
    },
  };
};

/** Where a placement lands: tab, 0-based row and column, and the first column of its month. */
export const locate = (p: Pick<Placement, "date" | "column">) => {
  const { year, month, day } = parts(p.date);
  const block = (month - 1) * SHEET_MAP.blockWidth;
  const row = SHEET_MAP.firstDayRow + day - 1;
  const col = block + SHEET_MAP.offsets[p.column];
  return { tab: String(year), row, col, block, day, address: `${year}!${a1(row, col)}` };
};

export const ECONOMIA_TAB = "Economia";
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const label = (cell: ApiCell | undefined) =>
  String(cell?.effectiveValue?.stringValue ?? cell?.effectiveValue?.numberValue ?? "")
    .trim()
    .toLowerCase();

/**
 * The month's cell in the Economia tab. Each year is a block whose header on row 4 reads
 * `2026 | Entradas | Economia | %`, with the months jan to dez on rows 5 to 16 under the year.
 * Anything else stops the write: the reader does not guess.
 */
export const locateEconomia = (rows: readonly (readonly ApiCell[])[], date: LocalDate) => {
  const { year, month } = parts(date);
  const head = rows[3] ?? [];
  const at = head.findIndex((c) => label(c) === String(year));
  if (at < 0) throw new WriteError(`a aba ${ECONOMIA_TAB} não tem o bloco de ${year}`);
  if (label(head[at + 1]) !== "entradas" || label(head[at + 2]) !== "economia")
    throw new WriteError(
      `a aba ${ECONOMIA_TAB} mudou: esperava Entradas e Economia ao lado de ${year}`,
    );
  const row = 3 + month;
  if (label(rows[row]?.[at]) !== MONTHS[month - 1])
    throw new WriteError(
      `a aba ${ECONOMIA_TAB} mudou: esperava ${MONTHS[month - 1]} abaixo de ${year}`,
    );
  const col = at + 2;
  return { tab: ECONOMIA_TAB, row, col, address: `${ECONOMIA_TAB}!${a1(row, col)}` };
};

/** A short, stable id of a cell's contents: the preview hands it out and the write checks it. */
export const fingerprint = async (cell: ApiCell | undefined): Promise<string> => {
  const data = JSON.stringify([enteredOf(cell), cell?.note ?? ""]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return [...new Uint8Array(hash).slice(0, 12)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const enteredOf = (cell: ApiCell | undefined): EnteredValue => {
  const v = cell?.userEnteredValue ?? {};
  if (v.formulaValue !== undefined) return { formulaValue: v.formulaValue };
  if (v.numberValue !== undefined) return { numberValue: v.numberValue };
  if (v.stringValue !== undefined) return { stringValue: v.stringValue };
  return {};
};

const saldoOf = (cells: ApiCell[]): Cents => {
  const n = cells[SHEET_MAP.offsets.saldo]?.effectiveValue?.numberValue;
  if (n === undefined) throw new WriteError("a coluna Saldo deste dia não tem valor");
  return fromReais(n);
};

export interface PartPreview {
  readonly address: string;
  readonly date: string;
  readonly column: Placement["column"];
  readonly before: Cents;
  readonly after: Cents;
  readonly formula: string;
  readonly note: string;
  /** The cell as read now; the write refuses if the cell no longer matches it. */
  readonly fingerprint: string;
}

type Where = Pick<Placement, "date" | "column" | "target">;

/** The cell a placement changes, read now; `cells` is the day's row, for its Saldo. */
interface Site {
  readonly tab: string;
  readonly row: number;
  readonly col: number;
  readonly address: string;
  readonly sheetId: number;
  readonly cell: ApiCell | undefined;
  readonly cells?: ApiCell[];
}

const readSite = async (api: SheetsApi, p: Where): Promise<Site> => {
  if (p.target === "economia") {
    const { sheetId, rows } = await api.readEconomia();
    const at = locateEconomia(rows, p.date);
    return { ...at, sheetId, cell: rows[at.row]?.[at.col] };
  }
  const at = locate(p);
  const { sheetId, cells } = await api.readRow(at.tab, at.row, at.block);
  const day = cells[SHEET_MAP.offsets.data]?.effectiveValue?.numberValue;
  if (day !== at.day)
    throw new WriteError(
      `a planilha mudou: a linha de ${ddmm(p.date)} mostra o dia ${day ?? "vazio"}`,
    );
  const { tab, row, col, address } = at;
  return { tab, row, col, address, sheetId, cells, cell: cells[SHEET_MAP.offsets[p.column]] };
};

/** Every placement's cell, read at once; one cell twice in an entry is refused. */
const readSites = async (api: SheetsApi, placements: readonly Where[]): Promise<Site[]> => {
  const sites = await Promise.all(placements.map((p) => readSite(api, p)));
  const seen = new Set<string>();
  for (const [i, site] of sites.entries()) {
    const p = placements[i] as Where;
    if (seen.has(site.address))
      throw new WriteError(`${where(p.column, p.target, p.date)} aparece duas vezes no lançamento`);
    seen.add(site.address);
  }
  return sites;
};

const plan = (site: Site, p: Placement) => {
  const result =
    p.target === "economia"
      ? planEconomiaEdit(site.cell, p)
      : planCellEdit(site.cell, { ...p, dropForecast: dropsForecast(p) });
  if (!result.ok) throw new WriteError(`o Neko não consegue mudar ${placeOf(p)}: ${result.reason}`);
  return result;
};

/** What the entry would change, read from the sheet now, without writing anything. */
export const previewEntry = async (
  api: SheetsApi,
  placements: readonly Placement[],
): Promise<PartPreview[]> => {
  const sites = await readSites(api, placements);
  const out: PartPreview[] = [];
  for (const [i, p] of placements.entries()) {
    const site = sites[i] as Site;
    const edit = plan(site, p);
    out.push({
      address: site.address,
      date: p.date,
      column: p.column,
      before: edit.before,
      after: edit.after,
      formula: edit.formula,
      note: edit.note,
      fingerprint: await fingerprint(site.cell),
    });
  }
  return out;
};

interface OpRow {
  entry_id: string;
  description: string;
  part: number;
  state: "writing" | "done" | "failed" | "undone";
  tab: string;
  cell: string;
  date: string;
  column_name: Placement["column"];
  target: Placement["target"];
  before_value: string;
  before_note: string;
  after_formula: string;
  after_note: string;
  before_total: number;
  after_total: number;
  error: string | null;
}

export interface CommitResult {
  readonly entryId: string;
  readonly state: "done" | "failed" | "undone";
  readonly parts: readonly { address: string; before: Cents; after: Cents; state: string }[];
  /** Why a part failed, in words the owner can act on. */
  readonly error?: string;
}

const isAfter = (
  cell: ApiCell | undefined,
  op: Pick<OpRow, "target" | "after_total" | "after_note">,
) => {
  const check = op.target === "economia" ? checkEconomia(cell) : checkCell(cell);
  return check.ok && check.total === op.after_total && (cell?.note ?? "") === op.after_note;
};

const whereOf = (op: OpRow): Where => ({
  date: op.date as LocalDate,
  column: op.column_name,
  target: op.target,
});

const isBefore = (cell: ApiCell | undefined, op: Pick<OpRow, "before_value" | "before_note">) =>
  JSON.stringify(enteredOf(cell)) === JSON.stringify(JSON.parse(op.before_value)) &&
  (cell?.note ?? "") === op.before_note;

const signed = (column: Placement["column"], amount: number) =>
  column === "entrada" ? amount : -amount;

const opsOf = async (db: D1Database, entryId: string) =>
  (
    await db
      .prepare("SELECT * FROM entry_op WHERE entry_id = ? ORDER BY part")
      .bind(entryId)
      .all<OpRow>()
  ).results;

const result = async (db: D1Database, entryId: string): Promise<CommitResult> => {
  const ops = await opsOf(db, entryId);
  const state = ops.some((o) => o.state === "failed")
    ? "failed"
    : ops.every((o) => o.state === "undone")
      ? "undone"
      : "done";
  const error = ops.find((o) => o.state === "failed")?.error ?? undefined;
  return {
    entryId,
    state,
    ...(error ? { error } : {}),
    parts: ops.map((o) => ({
      address: `${o.tab}!${o.cell}`,
      before: cents(o.before_total),
      after: cents(o.after_total),
      state: o.state,
    })),
  };
};

const setAll = (
  db: D1Database,
  entryId: string,
  state: OpRow["state"],
  at: string,
  error: string | null = null,
) =>
  db
    .prepare("UPDATE entry_op SET state = ?, error = ?, updated_at = ? WHERE entry_id = ?")
    .bind(state, error, at, entryId)
    .run();

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * How much each changed day's Saldo must move. Saldo carries from day to day and from one year
 * tab to the next, so a day moves by every line changed on it or before it.
 */
const saldoCheck = (
  placements: readonly Placement[],
  edits: readonly { before: Cents; after: Cents }[],
  before: readonly Site[],
  after: readonly Site[],
): string | null => {
  for (const [i, p] of placements.entries()) {
    const was = before[i]?.cells;
    const now = after[i]?.cells;
    if (!was || !now) continue;
    const moved = placements.reduce((sum, q, j) => {
      const e = edits[j];
      return q.target === "economia" || q.date > p.date || !e
        ? sum
        : sum + signed(q.column, e.after - e.before);
    }, 0);
    if (saldoOf(now) - saldoOf(was) !== moved)
      return `o Saldo de ${ddmm(p.date)} não bateu depois de gravar`;
  }
  return null;
};

/**
 * Writes an entry: every cell in one request, journaled first, then read back. `entryId` is the
 * idempotency key: sending the same entry again returns what was written the first time, and
 * finishes a launch whose connection dropped midway. `fingerprints` are the ones `previewEntry`
 * returned; if any cell changed since the preview, nothing is written. Without them (Para lançar,
 * one tap), each changed line must still hold the value the queue saw. If the cells do not read
 * back as planned, all of them go back, so an entry lands whole or not at all.
 */
export const commitEntry = async (
  db: D1Database,
  api: SheetsApi,
  entryId: string,
  placements: readonly Placement[],
  fingerprints: readonly string[] | undefined,
  now: () => string = () => new Date().toISOString(),
): Promise<CommitResult> => {
  if (fingerprints && fingerprints.length !== placements.length)
    throw new WriteError("a prévia não corresponde ao lançamento");
  const existing = await opsOf(db, entryId);
  if (existing.length > 0) {
    // Sent again: a finished entry (written, failed or undone) is reported, not written twice.
    if (existing.some((o) => o.state !== "writing" && o.state !== "done"))
      return result(db, entryId);
    if (existing.length === placements.length && existing.every((o) => o.state === "done"))
      return result(db, entryId);
    // A previous attempt stopped between the journal and the check: see where the cells are.
    const cells = await Promise.all(existing.map((o) => readSite(api, whereOf(o))));
    if (
      existing.length === placements.length &&
      existing.every((o, i) => isAfter(cells[i]?.cell, o))
    ) {
      await setAll(db, entryId, "done", now());
      return result(db, entryId);
    }
    if (!existing.every((o, i) => isBefore(cells[i]?.cell, o))) {
      let error = "a planilha mudou no meio da gravação";
      await restoreAll(api, existing, false).catch((e) => {
        error = `${error}; ${messageOf(e)}`;
      });
      await setAll(db, entryId, "failed", now(), error);
      return result(db, entryId);
    }
    await db.prepare("DELETE FROM entry_op WHERE entry_id = ?").bind(entryId).run();
  }

  const sites = await readSites(api, placements);
  if (fingerprints) {
    const prints = await Promise.all(sites.map((s) => fingerprint(s.cell)));
    const moved = prints.findIndex((f, i) => f !== fingerprints[i]);
    const p = placements[moved];
    if (p)
      throw new WriteError(
        `${placeOf(p)} mudou na planilha agora há pouco; confira e lance de novo`,
      );
  }
  const edits = placements.map((p, i) => plan(sites[i] as Site, p));

  const t = now();
  await db.batch(
    placements.map((p, part) => {
      const site = sites[part] as Site;
      const edit = edits[part] as (typeof edits)[number];
      return db
        .prepare(
          `INSERT INTO entry_op (entry_id, part, created_at, updated_at, state, tab, cell, date,
            column_name, section, target, amount, description, before_value, before_note,
            after_formula, after_note, before_total, after_total)
           VALUES (?, ?, ?, ?, 'writing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          entryId,
          part,
          t,
          t,
          site.tab,
          a1(site.row, site.col),
          p.date,
          p.column,
          p.section,
          p.target,
          p.amount,
          p.description,
          JSON.stringify(enteredOf(site.cell)),
          site.cell?.note ?? "",
          edit.formula,
          edit.note,
          edit.before,
          edit.after,
        );
    }),
  );

  let writeError: string | null = null;
  try {
    await api.writeCells(
      sites.map((site, i) => {
        const edit = edits[i] as (typeof edits)[number];
        return {
          sheetId: site.sheetId,
          row: site.row,
          col: site.col,
          value: edit.formula === "" ? {} : { formulaValue: edit.formula },
          note: edit.note,
        };
      }),
    );
  } catch (e) {
    writeError = messageOf(e);
    // Before the new protection script runs, the whole Economia tab is closed to Neko.
    if (sites.some((s) => s.tab === ECONOMIA_TAB) && /respondeu 403|protegida/.test(writeError))
      writeError = "a aba Economia está protegida para o Neko; rode de novo o script de proteção";
  }

  // Read back even when Google answered with an error: the answer may be lost after the write.
  const ops = await opsOf(db, entryId);
  const back = await readSites(api, placements);
  let error: string | null = null;
  const off = placements.findIndex((p, i) => {
    const edit = edits[i] as (typeof edits)[number];
    return !isAfter(back[i]?.cell, {
      target: p.target,
      after_total: edit.after,
      after_note: edit.note,
    });
  });
  const offPlace = placements[off];
  if (offPlace) error = writeError ?? `${placeOf(offPlace)} não ficou como devia`;
  else {
    try {
      error = saldoCheck(placements, edits, sites, back);
    } catch (e) {
      error = messageOf(e);
    }
  }
  if (error === null) {
    await setAll(db, entryId, "done", now());
    return result(db, entryId);
  }
  if (!ops.every((o, i) => isBefore(back[i]?.cell, o))) {
    // Put every cell back to what it was, whatever this write turned it into.
    const failed = error;
    await restoreAll(api, ops, true).catch((e) => {
      error = `${failed}; e não consegui desfazer: ${messageOf(e)}`;
    });
  }
  await setAll(db, entryId, "failed", now(), error);
  return result(db, entryId);
};

/**
 * Entries a crashed request left halfway (the old part-by-part writer could stop between parts
 * when the phone's connection dropped). Run under the write lock, so nothing else is writing:
 * each goes back to how the sheet was, so no entry stays half launched, and Para lançar shows
 * it again. Only the ones older than `olderThan`, so a retry of the same launch still finishes it.
 */
export const healOrphans = async (
  db: D1Database,
  api: SheetsApi,
  olderThan: string,
  now: () => string = () => new Date().toISOString(),
): Promise<void> => {
  const { results } = await db
    .prepare(
      "SELECT DISTINCT entry_id FROM entry_op WHERE state = 'writing' AND updated_at < ? LIMIT 5",
    )
    .bind(olderThan)
    .all<{ entry_id: string }>();
  for (const { entry_id } of results) {
    const ops = (await opsOf(db, entry_id)).filter(
      (o) => o.state === "writing" || o.state === "done",
    );
    let error = "a conexão caiu no meio da gravação; o Neko desfez o que tinha gravado";
    await restoreAll(api, ops, false).catch((e) => {
      error = `a conexão caiu no meio da gravação; ${messageOf(e)}`;
    });
    await db
      .prepare(
        "UPDATE entry_op SET state = 'failed', error = ?, updated_at = ? WHERE entry_id = ? AND state IN ('writing', 'done')",
      )
      .bind(error, now(), entry_id)
      .run();
  }
};

/**
 * Writes the stored cells back in one request, only where a cell is still exactly as Neko left
 * it; a cell already back as it was is left alone. `justWritten` is for the moment right after a
 * write that did not read back as planned: the cells then hold whatever that write became, and
 * go back to what they were.
 */
const restoreAll = async (api: SheetsApi, ops: readonly OpRow[], justWritten: boolean) => {
  const sites = await Promise.all(ops.map((op) => readSite(api, whereOf(op))));
  const todo = ops
    .map((op, i) => ({ op, site: sites[i] as Site }))
    .filter(({ op, site }) => !isBefore(site.cell, op));
  const moved = justWritten ? undefined : todo.find(({ op, site }) => !isAfter(site.cell, op));
  if (moved)
    throw new WriteError(`${placeOfOp(moved.op)} mudou depois do lançamento; desfaça na planilha`);
  if (todo.length === 0) return;
  await api.writeCells(
    todo.map(({ op, site }) => ({
      sheetId: site.sheetId,
      row: site.row,
      col: site.col,
      value: JSON.parse(op.before_value) as EnteredValue,
      note: op.before_note,
    })),
  );
  const back = await Promise.all(todo.map(({ op }) => readSite(api, whereOf(op))));
  const stuck = todo.find(({ op }, i) => !isBefore(back[i]?.cell, op));
  if (stuck) throw new WriteError(`${placeOfOp(stuck.op)} não voltou ao que era`);
};

/**
 * Undoes an entry: every cell goes back to what it was, if it is still as Neko left it. If the
 * owner changed one of the cells after, nothing is touched and the error names the cell.
 */
export const undoEntry = async (
  db: D1Database,
  api: SheetsApi,
  entryId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<CommitResult> => {
  const all = await opsOf(db, entryId);
  const ops = all.filter((o) => o.state === "done");
  // Sent again after the connection dropped: the first Desfazer is reported, not an error.
  if (ops.length === 0 && all.some((o) => o.state === "undone")) return result(db, entryId);
  if (ops.length === 0) throw new WriteError("não há lançamento gravado para desfazer");
  if (ops.every(isForecastOp)) return undoForecast(db, api, entryId, ops, now);
  await restoreAll(api, ops, false);
  await db
    .prepare(
      "UPDATE entry_op SET state = 'undone', updated_at = ? WHERE entry_id = ? AND state = 'done'",
    )
    .bind(now(), entryId)
    .run();
  return result(db, entryId);
};

/**
 * The Diário previsto (specs/005-lancamentos, Fase 3) touches up to a year of days at once, so it
 * writes a whole year tab in one go instead of cell by cell, with the same care: each tab is read,
 * every changing cell is journaled, all of them are written in one request (all or none), and the
 * tab is read back. Each cell and each changed day's Saldo must show exactly the change, or the
 * tab goes back to what it was. A Diário the owner wrote stays as it is.
 */

const isForecastOp = (op: Pick<OpRow, "column_name" | "target" | "description">) =>
  op.column_name === "diario" && op.target === "line" && op.description === FORECAST;

/** What setting a day's forecast to `value` does to its Diário cell; null leaves it alone. */
export const forecastEdit = (cell: ApiCell | undefined, value: Cents): EditOp | null => {
  const check = checkCell(cell);
  if (!check.ok) return null;
  const items = parseNote(cell?.note).items;
  const forecast = items.find(isForecastItem);
  const line = { section: null, description: FORECAST, target: "line" } as const;
  if (value === 0) return forecast ? { ...line, was: forecast.amount, amount: cents(0) } : null;
  if (check.total === 0 && items.length === 0) return { ...line, amount: value };
  if (forecast && items.length === 1 && forecast.amount !== value)
    return { ...line, was: forecast.amount, amount: value };
  return null;
};

/** The day rows of a tab as the writer reads them: row 0 is the first day. */
const dayCell = (rows: ApiCell[][], row: number, col: number) =>
  rows[row - SHEET_MAP.firstDayRow]?.[col];

const saldoAt = (rows: ApiCell[][], row: number, block: number): number | undefined =>
  dayCell(rows, row, block + SHEET_MAP.offsets.saldo)?.effectiveValue?.numberValue;

interface ForecastChange {
  readonly date: LocalDate;
  readonly row: number;
  readonly col: number;
  readonly block: number;
  readonly cell: ApiCell | undefined;
  readonly op: EditOp;
  readonly formula: string;
  readonly note: string;
  readonly before: Cents;
  readonly after: Cents;
}

const INSERT_OP = `INSERT INTO entry_op (entry_id, part, created_at, updated_at, state, tab, cell, date,
  column_name, section, target, amount, description, before_value, before_note,
  after_formula, after_note, before_total, after_total)
  VALUES (?, ?, ?, ?, 'writing', ?, ?, ?, 'diario', NULL, 'line', ?, ?, ?, ?, ?, ?, ?, ?)`;

/** D1 runs a batch as one transaction; a few hundred rows go in a few batches. */
const BATCH = 100;

const inBatches = async (db: D1Database, stmts: D1PreparedStatement[]) => {
  for (let i = 0; i < stmts.length; i += BATCH) await db.batch(stmts.slice(i, i + BATCH));
};

/** What went wrong with a tab just written, or null when every cell and Saldo is as planned. */
const checkTab = (rows: ApiCell[][], before: ApiCell[][], changes: readonly ForecastChange[]) => {
  let moved = 0;
  for (const c of changes) {
    const cell = dayCell(rows, c.row, c.col);
    if (!isAfter(cell, { target: "line", after_total: c.after, after_note: c.note }))
      return `${c.date} não ficou como planejado`;
    moved += c.after - c.before;
    const was = saldoAt(before, c.row, c.block);
    const now = saldoAt(rows, c.row, c.block);
    if (was === undefined || now === undefined || fromReais(now) - fromReais(was) !== -moved)
      return `o Saldo de ${c.date} não mudou o que devia`;
  }
  return null;
};

/** Puts the cells of one tab back as they were, in one request, and checks they are. */
const restoreTab = async (
  api: SheetsApi,
  tab: string,
  sheetId: number,
  ops: readonly Pick<OpRow, "cell" | "before_value" | "before_note">[],
) => {
  const at = ops.map((op) => ({ op, ...cellIndex(op.cell) }));
  await api.writeCells(
    at.map(({ op, row, col }) => ({
      sheetId,
      row,
      col,
      value: JSON.parse(op.before_value) as EnteredValue,
      note: op.before_note,
    })),
  );
  const { rows } = await api.readDays(tab);
  if (at.some(({ op, row, col }) => !isBefore(dayCell(rows, row, col), op)))
    throw new WriteError(`a aba ${tab} não voltou ao que era`);
};

/** `BF12` → 0-based row 11, column 57. */
const cellIndex = (address: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(address);
  if (!m) throw new Error(`bad cell ${address}`);
  const col = [...(m[1] ?? "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { row: Number(m[2]) - 1, col };
};

/**
 * Sets the Diário previsto of `days` to `value` (0 takes it away). Days the owner wrote in are
 * left out, and so is a cell the reader does not fully understand. `entryId` is the idempotency
 * key, as for `commitEntry`.
 */
export const writeForecast = async (
  db: D1Database,
  api: SheetsApi,
  entryId: string,
  days: readonly LocalDate[],
  value: Cents,
  now: () => string = () => new Date().toISOString(),
): Promise<CommitResult> => {
  if ((await opsOf(db, entryId)).length > 0) return result(db, entryId);
  const tabs = new Map<string, LocalDate[]>();
  for (const date of [...new Set(days)].sort()) {
    const tab = date.slice(0, 4);
    tabs.set(tab, [...(tabs.get(tab) ?? []), date]);
  }
  let part = 0;
  const written: { tab: string; sheetId: number }[] = [];
  for (const [tab, list] of tabs) {
    const { sheetId, rows } = await api.readDays(tab);
    const changes: ForecastChange[] = [];
    for (const date of list) {
      const at = locate({ date, column: "diario" });
      const day = dayCell(rows, at.row, at.block + SHEET_MAP.offsets.data)?.effectiveValue
        ?.numberValue;
      if (day !== at.day)
        throw new WriteError(
          `a planilha mudou: a linha de ${ddmm(date)} mostra o dia ${day ?? "vazio"}`,
        );
      const cell = dayCell(rows, at.row, at.col);
      const op = forecastEdit(cell, value);
      const edit = op && planCellEdit(cell, op);
      if (!op || !edit?.ok) continue;
      changes.push({ date, ...at, cell, op, ...edit });
    }
    if (changes.length === 0) continue;
    const t = now();
    await inBatches(
      db,
      changes.map((c, i) =>
        db
          .prepare(INSERT_OP)
          .bind(
            entryId,
            part + i,
            t,
            t,
            tab,
            a1(c.row, c.col),
            c.date,
            c.op.amount,
            FORECAST,
            JSON.stringify(enteredOf(c.cell)),
            c.cell?.note ?? "",
            c.formula,
            c.note,
            c.before,
            c.after,
          ),
      ),
    );
    let error: string | null;
    try {
      await api.writeCells(
        changes.map((c) => ({
          sheetId,
          row: c.row,
          col: c.col,
          value: c.formula === "" ? {} : { formulaValue: c.formula },
          note: c.note,
        })),
      );
      error = checkTab((await api.readDays(tab)).rows, rows, changes);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const range = [entryId, part, part + changes.length - 1] as const;
    if (error === null) {
      await db
        .prepare(
          "UPDATE entry_op SET state = 'done', updated_at = ? WHERE entry_id = ? AND part BETWEEN ? AND ?",
        )
        .bind(now(), ...range)
        .run();
      written.push({ tab, sheetId });
      part += changes.length;
      continue;
    }
    // This tab goes back, and so do the ones written before it: the entry lands whole or not.
    const ops = await opsOf(db, entryId);
    for (const w of [{ tab, sheetId }, ...written.reverse()])
      await restoreTab(
        api,
        w.tab,
        w.sheetId,
        ops.filter((o) => o.tab === w.tab),
      ).catch((e) => {
        error = `${error}; e não consegui voltar a aba ${w.tab}: ${e instanceof Error ? e.message : e}`;
      });
    await db
      .prepare(
        "UPDATE entry_op SET state = 'undone', updated_at = ? WHERE entry_id = ? AND state = 'done'",
      )
      .bind(now(), entryId)
      .run();
    await db
      .prepare(
        "UPDATE entry_op SET state = 'failed', error = ?, updated_at = ? WHERE entry_id = ? AND part BETWEEN ? AND ?",
      )
      .bind(error, now(), ...range)
      .run();
    return result(db, entryId);
  }
  if (part === 0) return { entryId, state: "done", parts: [] };
  return result(db, entryId);
};

/** Undoes a Diário previsto entry tab by tab, only if every cell is still as Neko left it. */
const undoForecast = async (
  db: D1Database,
  api: SheetsApi,
  entryId: string,
  ops: readonly OpRow[],
  now: () => string,
): Promise<CommitResult> => {
  const tabs = [...new Set(ops.map((o) => o.tab))];
  const read = new Map<string, { sheetId: number; rows: ApiCell[][] }>();
  for (const tab of tabs) {
    const got = await api.readDays(tab);
    read.set(tab, got);
    for (const op of ops.filter((o) => o.tab === tab)) {
      const { row, col } = cellIndex(op.cell);
      if (!isAfter(dayCell(got.rows, row, col), op))
        throw new WriteError(`${placeOfOp(op)} mudou depois do lançamento; desfaça na planilha`);
    }
  }
  for (const tab of tabs.reverse())
    await restoreTab(
      api,
      tab,
      read.get(tab)?.sheetId ?? 0,
      ops.filter((o) => o.tab === tab),
    );
  await db
    .prepare(
      "UPDATE entry_op SET state = 'undone', updated_at = ? WHERE entry_id = ? AND state = 'done'",
    )
    .bind(now(), entryId)
    .run();
  return result(db, entryId);
};
