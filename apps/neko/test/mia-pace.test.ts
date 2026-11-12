import { describe, expect, it } from "vitest";
import { PACE_LAG, PACE_MIN, paceCut, paceStep } from "../src/web/miaPace.ts";

// The same cases as the app's Mia2PaceTest: both show her words the same way.
describe("Mia's words at reading pace", () => {
  it("goes at least PACE_MIN characters a second", () => {
    expect(paceStep(0, 10, 0.05)).toBeCloseTo(PACE_MIN * 0.05);
    expect(paceStep(9, 10, 1)).toBe(10);
  });

  it("is never much more than PACE_LAG behind a burst", () => {
    let pos = 0;
    for (let t = 0; t < 1.6; t += 1 / 60) pos = paceStep(pos, 600, 1 / 60);
    expect(pos).toBe(600);
    expect(paceStep(0, 600, 1 / 60)).toBeCloseTo(600 / PACE_LAG / 60);
  });

  it("shows whole words, R$ with its amount, and the last word once it is complete", () => {
    const text = "Ainda cabem R$ 1.240,60 no teto";
    expect(paceCut(text, 0, false)).toBe(0);
    expect(paceCut(text, 1, false)).toBe("Ainda".length);
    expect(paceCut(text, 7, false)).toBe("Ainda cabem".length);
    expect(paceCut(text, 13, false)).toBe("Ainda cabem R$ 1.240,60".length);
    // "teto" may still be growing until a space comes or the text is done.
    expect(paceCut(text, 40, false)).toBe("Ainda cabem R$ 1.240,60 no".length);
    expect(paceCut(text, 40, true)).toBe(text.length);
    expect(paceCut("Ainda cabem R$", 40, false)).toBe("Ainda cabem".length);
    expect(paceCut("Ainda cabem R$ ", 40, false)).toBe("Ainda cabem".length);
    expect(paceCut("Outubro fechou ", 40, false)).toBe("Outubro fechou".length);
    expect(paceCut("Fatura\n\n- Pix: R$ 12", 10, false)).toBe("Fatura\n\n- Pix:".length);
    // A list's mark never shows without its item, as R$ never shows without its amount.
    expect(paceCut("- Faturas: R$ 3", 1, false)).toBe("- Faturas:".length);
    expect(paceCut("Fatura\n\n- Pix", 9, false)).toBe("Fatura".length);
    expect(paceCut("Fatura\n1. Pix e débito", 8, false)).toBe("Fatura\n1. Pix".length);
    expect(paceCut("a - b c", 3, false)).toBe("a -".length);
  });
});
