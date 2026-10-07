import { describe, expect, it } from "vitest";
import { settingsHash, UserSettings } from "../src/worker/settings.ts";

describe("settings", () => {
  it("keeps checked Conferência points out of the projection cache key", async () => {
    const base = UserSettings.parse({});
    const checked = { ...base, reviewed: ["balance-mismatch|2026-09-13|2026!AU12"] };
    expect(await settingsHash(checked)).toBe(await settingsHash(base));
    expect(await settingsHash({ ...base, othersCards: ["Verde"] })).not.toBe(
      await settingsHash(base),
    );
  });
});
