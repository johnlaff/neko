import { z } from "zod";

/**
 * Card purchases the Android app read from the bank app's notification, the moment the bank told
 * the owner (specs/002, "Notificações", item 11). Only the value, the shop and the card's last
 * digits leave the phone. They move the month's ceiling until Open Finance brings the same charge
 * (engine `stillProvisional`), and are never written to the sheet.
 */

/** The banks whose apps the phone reads, by the name a linked bank's label carries. */
export const PHONE_BANKS = ["Bradesco", "Itaú", "Inter", "Mercado Pago"] as const;

export const PhonePurchase = z.object({
  /** The phone's key for the notification, so the same one is kept once. */
  id: z.string().trim().min(8).max(80),
  bank: z.enum(PHONE_BANKS),
  /** Cents, positive. */
  amount: z.number().int().positive().max(100_000_00),
  last4: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  merchant: z.string().trim().max(80),
  /** When the bank notified, as an ISO instant. */
  at: z.string().datetime(),
});
export type PhonePurchase = z.infer<typeof PhonePurchase>;

/** How long a purchase the phone saw is kept: the bank brings it well before. */
const KEEP_DAYS = 15;
/**
 * How long one moves the ceiling while the bank has not brought it. Banks bring a card charge in a
 * day or two; one still missing after this was likely no credit purchase (a debit the notice did
 * not name), and stops counting.
 */
const COUNT_DAYS = 5;

export const savePhonePurchase = async (db: D1Database, p: PhonePurchase): Promise<void> => {
  await db
    .prepare(
      "INSERT INTO phone_purchase (id, bank, amount, last4, merchant, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
    )
    .bind(p.id, p.bank, p.amount, p.last4, p.merchant, p.at)
    .run();
};

/** The ones still counted: the last COUNT_DAYS; none before migration 0016 is applied. */
export const loadPhonePurchases = async (
  db: D1Database,
  now = new Date(),
): Promise<PhonePurchase[]> => {
  try {
    const since = new Date(now.getTime() - COUNT_DAYS * 86_400_000).toISOString();
    return (
      await db
        .prepare(
          "SELECT id, bank, amount, last4, merchant, at FROM phone_purchase WHERE at > ? ORDER BY at, id",
        )
        .bind(since)
        .all<PhonePurchase>()
    ).results;
  } catch (error) {
    console.error("phone purchases unreadable", error);
    return [];
  }
};

export const prunePhonePurchases = async (db: D1Database, now = new Date()): Promise<void> => {
  const since = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
  await db.prepare("DELETE FROM phone_purchase WHERE at <= ?").bind(since).run();
};
