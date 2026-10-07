import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/web/api.ts";

describe("web api settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fills in reviewed when an older Worker leaves it out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ dailyForecast: null, cards: [], othersCards: [] })),
    );
    const s = await api.settings();
    expect(s.reviewed).toEqual([]);
  });
});
