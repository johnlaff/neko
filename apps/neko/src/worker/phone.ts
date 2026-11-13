import { z } from "zod";

/**
 * Card purchases the Android app read from the bank app's notification, the moment the bank told
 * the owner (specs/002, "Avisos de compra"): the value, the shop and the card's last digits. Open
 * Finance checks each one (engine `phoneReads`). For now they only learn: a bank app's reads move
 * the month's ceiling only once it is in PHONE_RELEASED. They are never written to the sheet.
 *
 * The text of those notices comes too, kept as long, so the reading can be checked against the
 * banks' real wording (bank_notice).
 */

/** The banks whose apps the phone reads, by the name a linked bank's label carries. */
export const PHONE_BANKS = ["Bradesco", "Itaú", "Inter", "Mercado Pago"] as const;
export type PhoneBank = (typeof PHONE_BANKS)[number];

/**
 * The phone's wallets: only the words of their payment notices come, to learn how they speak. No
 * purchase is read from them, as the card's bank tells the same one.
 */
export const PHONE_WALLETS = ["Carteira do Google", "Samsung Wallet"] as const;

/**
 * The bank apps whose reads may move the ceiling, added here by hand, in a reviewed change, once
 * their real notices (bank_notice) and the bank's checks show the reading is right. Empty: the
 * phone's reads only learn, and the ceiling moves when the bank brings the purchase.
 */
export const PHONE_RELEASED: ReadonlySet<PhoneBank> = new Set<PhoneBank>([]);

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

/**
 * How long a purchase the phone read, and a notice's text, are kept: the bank brings the purchase
 * well before, and the reads of the days before are what earns a bank app the trust.
 */
const KEEP_DAYS = 15;

export const savePhonePurchase = async (db: D1Database, p: PhonePurchase): Promise<void> => {
  await db
    .prepare(
      "INSERT INTO phone_purchase (id, bank, amount, last4, merchant, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
    )
    .bind(p.id, p.bank, p.amount, p.last4, p.merchant, p.at)
    .run();
};

/** The ones kept, oldest first; none before migration 0016 is applied. */
export const loadPhonePurchases = async (
  db: D1Database,
  now = new Date(),
): Promise<PhonePurchase[]> => {
  try {
    const since = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
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

/**
 * A bank app's notice that speaks of a purchase or a card, or a phone wallet's notice of a payment,
 * word for word (PurchaseText.kt keeps): read or not, it shows how each one words its notices.
 */
export const BankNotice = z.object({
  /** The phone's key for the notice, so the same one is kept once. */
  id: z.string().trim().min(8).max(80),
  /** The bank app's package: one bank may word its two apps' notices differently. */
  app: z.string().regex(/^[a-z][\w.]{2,99}$/i),
  bank: z.enum([...PHONE_BANKS, ...PHONE_WALLETS]),
  title: z.string().max(300),
  text: z.string().max(2000),
  at: z.string().datetime(),
  /** Whether the phone took a purchase from it. */
  read: z.boolean(),
});
export type BankNotice = z.infer<typeof BankNotice>;

/** Kept once; dropped when migration 0017 is not applied yet, as the phone would only retry. */
export const saveBankNotice = async (db: D1Database, n: BankNotice): Promise<void> => {
  try {
    await db
      .prepare(
        "INSERT INTO bank_notice (id, app, bank, title, text, at, read) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
      )
      .bind(n.id, n.app, n.bank, n.title, n.text, n.at, n.read ? 1 : 0)
      .run();
  } catch (error) {
    console.error("bank notice not kept", error);
  }
};

export const prunePhonePurchases = async (db: D1Database, now = new Date()): Promise<void> => {
  const since = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString();
  await db.prepare("DELETE FROM phone_purchase WHERE at <= ?").bind(since).run();
  try {
    await db.prepare("DELETE FROM bank_notice WHERE at <= ?").bind(since).run();
  } catch (error) {
    console.error("bank notices not pruned", error);
  }
};
