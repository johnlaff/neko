import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env.ts";
import {
  BankNotice,
  loadPhonePurchases,
  PhonePurchase,
  prunePhonePurchases,
  saveBankNotice,
  savePhonePurchase,
} from "../src/worker/phone.ts";
import { sqliteD1 } from "./d1.ts";

const db = () => sqliteD1() as unknown as D1Database;
// Invented purchase (public repo).
const seen: PhonePurchase = {
  id: "phone-0001",
  bank: "Inter",
  amount: 4590,
  last4: "2222",
  merchant: "LIVRARIA",
  at: "2026-11-10T15:00:00.000Z",
};
const now = new Date("2026-11-11T12:00:00.000Z");

describe("card purchases the phone read", () => {
  it("keeps each notification once, and for 15 days", async () => {
    const d = db();
    await savePhonePurchase(d, seen);
    await savePhonePurchase(d, { ...seen, amount: 9999 });
    const week = { ...seen, id: "phone-0002", at: "2026-11-03T15:00:00.000Z" };
    const old = { ...seen, id: "phone-0000", at: "2026-10-20T15:00:00.000Z" };
    await savePhonePurchase(d, week);
    await savePhonePurchase(d, old);
    expect(await loadPhonePurchases(d, now)).toEqual([week, seen]);
    await prunePhonePurchases(d, now);
    expect(await loadPhonePurchases(d, new Date("2026-10-21T00:00:00.000Z"))).toEqual([week, seen]);
  });

  it("keeps a bank notice's words once, for 15 days, and refuses one from an unknown bank", async () => {
    const d = db();
    const notice: BankNotice = {
      id: "notice-0001",
      app: "br.com.intermedium",
      bank: "Inter",
      title: "Compra aprovada",
      text: "Compra de R$ 45,90 em LIVRARIA no cartão final 2222",
      at: seen.at,
      read: true,
    };
    await saveBankNotice(d, notice);
    await saveBankNotice(d, { ...notice, text: "outra" });
    await saveBankNotice(d, { ...notice, id: "notice-0000", at: "2026-10-20T15:00:00.000Z" });
    const kept = () => d.prepare("SELECT id, text, read FROM bank_notice ORDER BY id").all();
    expect((await kept()).results).toHaveLength(2);
    await prunePhonePurchases(d, now);
    expect((await kept()).results).toEqual([{ id: "notice-0001", text: notice.text, read: 1 }]);
    expect(BankNotice.safeParse({ ...notice, bank: "Outro" }).success).toBe(false);
    expect(BankNotice.safeParse({ ...notice, app: "../x" }).success).toBe(false);
    // A phone wallet's notice is kept too, only to learn its words.
    const wallet = {
      ...notice,
      app: "com.google.android.apps.walletnfcrel",
      bank: "Carteira do Google",
      read: false,
    };
    expect(BankNotice.safeParse(wallet).success).toBe(true);
    expect(BankNotice.safeParse({ ...wallet, bank: "Samsung Wallet" }).success).toBe(true);
  });

  it("takes only a purchase it can trust: a known bank, cents, four digits", () => {
    expect(PhonePurchase.safeParse(seen).success).toBe(true);
    const bad = [
      { ...seen, bank: "Outro" },
      { ...seen, amount: 45.9 },
      { ...seen, amount: -4590 },
      { ...seen, last4: "22" },
      { ...seen, at: "ontem" },
      { ...seen, id: "x" },
    ];
    for (const b of bad) expect(PhonePurchase.safeParse(b).success).toBe(false);
  });

  it("is taken only from a signed-in device, as are the notices' words", async () => {
    const env = {
      ALLOWED_EMAILS: "dono@example.com",
      SESSION_SECRET: "test-secret",
    } as unknown as Env;
    const worker = (await import("../src/worker/index.ts")).default;
    for (const path of ["purchases", "purchases/notice"]) {
      const response = await worker.fetch(
        new Request(`https://neko.test/api/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://neko.test" },
          body: JSON.stringify(seen),
        }) as never,
        env,
        {} as ExecutionContext,
      );
      expect(response.status).toBe(401);
    }
  });
});
