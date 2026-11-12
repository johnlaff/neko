import {
  cents,
  type EntryInput,
  localDate,
  MAX_INSTALLMENTS,
  type MiaProposal,
} from "@neko/engine";
import { z } from "zod";

/**
 * What Mia proposed in a conversation (Mia 2, part 3), kept for Para lançar. She only adds rows
 * here; the sheet changes when the owner taps Lançar, through /api/entries like any other item.
 */

export interface ProposalRow {
  readonly id: string;
  /** engine `EntryInput` as JSON. */
  readonly entry: string;
  readonly created_at: string;
}

/** A stored entry, checked again on the way out: a bad row is left out, never guessed. */
const Entry = z.object({
  kind: z.enum([
    "entrada",
    "diario",
    "conta",
    "investimento",
    "reserva",
    "resgate",
    "saida",
    "cartao",
  ]),
  amount: z.number().int().positive().max(100_000_000_00),
  description: z.string().trim().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  card: z.string().max(60).optional(),
  installments: z.number().int().min(1).max(MAX_INSTALLMENTS).optional(),
});

/** The proposals; none before migration 0019 is applied. */
export const loadProposals = async (db: D1Database): Promise<ProposalRow[]> => {
  try {
    return (
      await db
        .prepare("SELECT id, entry, created_at FROM mia_proposal ORDER BY created_at, id")
        .all<ProposalRow>()
    ).results;
  } catch (error) {
    console.error("mia proposals unreadable", error);
    return [];
  }
};

export const proposalsOf = (rows: readonly ProposalRow[]): MiaProposal[] =>
  rows.flatMap((r) => {
    let raw: unknown;
    try {
      raw = JSON.parse(r.entry);
    } catch {
      return [];
    }
    const e = Entry.safeParse(raw);
    if (!e.success) return [];
    const { amount, date, card, installments, ...rest } = e.data;
    const entry: EntryInput = {
      ...rest,
      amount: cents(amount),
      date: localDate(date),
      ...(card ? { card } : {}),
      ...(installments ? { installments } : {}),
    };
    return [{ id: r.id, entry }];
  });

/** Keeps one proposal; its id is the item's key in Para lançar (`mia:<id>`). */
export const saveProposal = async (
  db: D1Database,
  entry: EntryInput,
  now: Date,
): Promise<string> => {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO mia_proposal (id, entry, created_at) VALUES (?, ?, ?)")
    .bind(id, JSON.stringify(entry), now.toISOString())
    .run();
  return id;
};
