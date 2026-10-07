import type { Ledger, LocalDate } from "@neko/engine";
import { type ApiGrid, readYearTab, YEAR_TAB_RANGE } from "./grid.ts";

/** Fields mask for `spreadsheets.get`: values, formulas and notes of the ranges asked, nothing else. */
export const SHEET_FIELDS =
  "sheets(properties(title),data(rowData(values(formattedValue,effectiveValue,userEnteredValue,note))))";

export interface ApiSpreadsheet {
  sheets?: { properties?: { title?: string }; data?: ApiGrid[] }[];
}

export const yearTabRanges = (years: readonly number[]) =>
  years.map((y) => `'${y}'!${YEAR_TAB_RANGE}`);

export interface ReadResult {
  readonly ledger: Ledger;
  readonly years: number[];
  readonly ceiling: { readonly perDay: number; readonly date: LocalDate } | null;
}

/** Turns a `spreadsheets.get` response for year tabs into one continuous ledger. */
export const readSpreadsheet = (doc: ApiSpreadsheet): ReadResult => {
  const tabs = (doc.sheets ?? [])
    .map((s) => ({ title: s.properties?.title ?? "", grid: s.data?.[0] ?? {} }))
    .filter((t) => /^\d{4}$/.test(t.title))
    .sort((a, b) => a.title.localeCompare(b.title));
  const ledger = [];
  let ceiling: ReadResult["ceiling"] = null;
  for (const t of tabs) {
    const tab = readYearTab(t.grid, t.title, Number(t.title));
    ledger.push(...tab.rows);
    if (tab.ceiling) ceiling = { perDay: tab.ceiling.note.perDay, date: tab.ceiling.date };
  }
  return { ledger, years: tabs.map((t) => Number(t.title)), ceiling };
};
