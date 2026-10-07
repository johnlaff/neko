import {
  addDays,
  type CellValue,
  type Cents,
  cents,
  type DayRow,
  type LocalDate,
  localDate,
  type NoteItem,
} from "../src/index.ts";

const ref = { tab: "t", a1: "A1" };
export const item = (
  amount: number,
  description: string,
  section: string | null = "cartoes",
): NoteItem => ({
  amount: cents(amount),
  description,
  section,
});
export const cell = (amount = 0, items: NoteItem[] = []): CellValue => ({
  amount: cents(amount),
  items,
  unparsed: [],
  ref,
});

export interface DaySpec {
  entrada?: CellValue;
  saida?: CellValue;
  diario?: CellValue;
  saldo?: number | null;
  dateCellOk?: boolean;
}

/**
 * Builds consecutive days from `start`, chaining Saldo with the method's rule unless a day
 * overrides it, so tests only spell out what they are about.
 */
export const ledger = (
  start: string,
  days: number,
  opening: number,
  specs: Record<string, DaySpec> = {},
): DayRow[] => {
  const out: DayRow[] = [];
  let saldo = opening;
  let d: LocalDate = localDate(start);
  for (let i = 0; i < days; i++, d = addDays(d, 1)) {
    const s = specs[d] ?? {};
    const entrada = s.entrada ?? cell();
    const saida = s.saida ?? cell();
    const diario = s.diario ?? cell();
    saldo = saldo + entrada.amount - saida.amount - diario.amount;
    out.push({
      date: d,
      entrada,
      saida,
      diario,
      saldo:
        s.saldo === undefined ? (cents(saldo) as Cents) : s.saldo === null ? null : cents(s.saldo),
      saldoRef: ref,
      dateCellOk: s.dateCellOk ?? true,
      dateRef: ref,
    });
  }
  return out;
};
