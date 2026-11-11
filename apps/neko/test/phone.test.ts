import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env.ts";
import {
  loadPhonePurchases,
  PhonePurchase,
  prunePhonePurchases,
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
  it("keeps each notification once, counts it 5 days and drops it after 15", async () => {
    const d = db();
    await savePhonePurchase(d, seen);
    await savePhonePurchase(d, { ...seen, amount: 9999 });
    const week = { ...seen, id: "phone-0002", at: "2026-11-03T15:00:00.000Z" };
    const old = { ...seen, id: "phone-0000", at: "2026-10-20T15:00:00.000Z" };
    await savePhonePurchase(d, week);
    await savePhonePurchase(d, old);
    expect(await loadPhonePurchases(d, now)).toEqual([seen]);
    await prunePhonePurchases(d, now);
    expect(await loadPhonePurchases(d, new Date("2026-10-21T00:00:00.000Z"))).toEqual([week, seen]);
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

  it("is taken only from a signed-in device", async () => {
    const env = {
      ALLOWED_EMAILS: "dono@example.com",
      SESSION_SECRET: "test-secret",
    } as unknown as Env;
    const worker = (await import("../src/worker/index.ts")).default;
    const response = await worker.fetch(
      new Request("https://neko.test/api/purchases", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://neko.test" },
        body: JSON.stringify(seen),
      }) as never,
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
  });
});
