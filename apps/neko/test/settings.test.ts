import { describe, expect, it } from "vitest";
import { keepBankCards, settingsHash, UserSettings } from "../src/worker/settings.ts";

describe("settings", () => {
  it("keeps checked Conferência points out of the projection cache key", async () => {
    const base = UserSettings.parse({});
    const checked = { ...base, reviewed: ["balance-mismatch|2026-09-13|2026!AU12"] };
    expect(await settingsHash(checked)).toBe(await settingsHash(base));
    expect(await settingsHash({ ...base, othersCards: ["Verde"] })).not.toBe(
      await settingsHash(base),
    );
  });

  it("a form that does not send the bank cards keeps the saved ones", () => {
    const cards = [{ accountId: "a", cardNumber: null, card: "Visa" }];
    const current = UserSettings.parse({ bankCards: cards });
    expect(keepBankCards({ othersCards: ["Verde"] }, current)).toMatchObject({
      othersCards: ["Verde"],
      bankCards: cards,
    });
    expect(keepBankCards({ bankCards: [] }, current).bankCards).toEqual([]);
  });

  it("keeps the Diário previsto and its Desfazer out of the Ajustes form", () => {
    const undo = { entry: crypto.randomUUID(), dailyForecast: null, since: null };
    const current = UserSettings.parse({
      dailyForecast: 95_00,
      previstoSince: "2026-10-09",
      previstoUndo: undo,
    });
    expect(keepBankCards({ dailyForecast: 50_00 }, current)).toMatchObject({
      dailyForecast: 95_00,
      previstoSince: "2026-10-09",
      previstoUndo: undo,
    });
  });
});
