import { cents } from "@neko/engine";
import { describe, expect, it } from "vitest";
import {
  type ApiCell,
  checkCell,
  type EditOp,
  formulaTerm,
  noteAmount,
  parseNote,
  planCellEdit,
  planEconomiaEdit,
} from "../src/index.ts";

const sumCell = (formula: string, value: number, note?: string): ApiCell => ({
  userEnteredValue: { formulaValue: formula },
  effectiveValue: { numberValue: value },
  ...(note === undefined ? {} : { note }),
});
const line = (amount: number, description: string, section: string | null = null): EditOp => ({
  amount: cents(amount),
  description,
  section,
  target: "line",
});
const card = (amount: number, description: string): EditOp => ({
  amount: cents(amount),
  description,
  section: "cartoes",
  target: "card",
});
const plan = (cell: ApiCell | undefined, op: EditOp) => {
  const p = planCellEdit(cell, op);
  if (!p.ok) throw new Error(p.reason);
  return p;
};

describe("number formats", () => {
  it("writes formula terms like the owner: comma decimal, no thousands, no trailing zero", () => {
    expect([4240, 2000, 1, 10, 125240, 100050].map((c) => formulaTerm(cents(c)))).toEqual([
      "42,4",
      "20",
      "0,01",
      "0,1",
      "1252,4",
      "1000,5",
    ]);
  });
  it("writes note amounts with thousands dots and two decimals", () => {
    expect([4240, 1, 125240, 123456789].map((c) => noteAmount(cents(c)))).toEqual([
      "R$ 42,40",
      "R$ 0,01",
      "R$ 1.252,40",
      "R$ 1.234.567,89",
    ]);
  });
});

describe("checkCell", () => {
  it("accepts empty cells, the literal 0 of an empty Diário and consistent sums", () => {
    expect(checkCell(undefined)).toMatchObject({ ok: true, total: 0, terms: [] });
    expect(
      checkCell({ userEnteredValue: { numberValue: 0 }, effectiveValue: { numberValue: 0 } }),
    ).toMatchObject({ ok: true, total: 0 });
    expect(
      checkCell(sumCell("=SUM(100,5\n+20)", 120.5, "R$ 100,50 - Item A\nR$ 20,00 - Item B")),
    ).toMatchObject({ ok: true, total: 12050, terms: [10050, 2000] });
    expect(
      checkCell({
        userEnteredValue: { numberValue: 15 },
        effectiveValue: { numberValue: 15 },
        note: "R$ 15,00 - Item",
      }),
    ).toMatchObject({ ok: true, total: 1500, terms: [1500] });
  });
  it("ignores the zero line of an empty bill", () => {
    expect(
      checkCell(sumCell("=SUM(50)", 50, "CONTAS\nR$ 50,00 - Luz\n\nFATURAS:\nR$ 0,00 - Banco X")),
    ).toMatchObject({ ok: true, total: 5000 });
  });
  it("refuses anything it does not fully understand", () => {
    const reason = (c: ApiCell) => {
      const r = checkCell(c);
      return r.ok ? null : r.reason;
    };
    expect(reason({ userEnteredValue: { stringValue: "oi" } })).toMatch(/texto/);
    expect(reason(sumCell("=A1+B2", 3, "R$ 3,00 - x"))).toMatch(/soma simples/);
    expect(reason(sumCell("=SUM(10;20)", 30, "R$ 30,00 - x"))).toMatch(/soma simples/);
    expect(
      reason({ userEnteredValue: { numberValue: 15 }, effectiveValue: { numberValue: 15 } }),
    ).toMatch(/sem nota|não tem nota/);
    expect(reason(sumCell("=SUM(10+10)", 20, "R$ 20,00 - Item"))).toMatch(/mesmos valores/);
    expect(reason(sumCell("=SUM(10+10)", 21, "R$ 10,00 - a\nR$ 10,00 - b"))).toMatch(/soma/);
    expect(reason(sumCell("=SUM(10)", 10, "R$ 10,00 - a\nR$ dez - b"))).toMatch(/não entendo/);
    expect(
      reason({ userEnteredValue: { numberValue: -5 }, effectiveValue: { numberValue: -5 } }),
    ).toMatch(/negativo/);
  });
});

describe("planCellEdit: a new line", () => {
  it("starts an empty cell", () => {
    expect(plan(undefined, line(4240, "Restaurante"))).toEqual({
      ok: true,
      formula: "=SUM(42,4)",
      note: "R$ 42,40 - Restaurante",
      before: 0,
      after: 4240,
    });
    expect(
      plan(
        { userEnteredValue: { numberValue: 0 }, effectiveValue: { numberValue: 0 } },
        line(1000, "Mercado"),
      ).formula,
    ).toBe("=SUM(10)");
  });

  it("turns a plain number into a sum", () => {
    const p = plan(
      {
        userEnteredValue: { numberValue: 0.4 },
        effectiveValue: { numberValue: 0.4 },
        note: "R$ 0,40 - Rendimento",
      },
      line(1500, "Reembolso"),
    );
    expect(p.formula).toBe("=SUM(0,4+15)");
    expect(p.note).toBe("R$ 0,40 - Rendimento\nR$ 15,00 - Reembolso");
  });

  it("appends after the last term and keeps line breaks inside the formula", () => {
    expect(
      plan(sumCell("=SUM(6012,73\n)", 6012.73, "R$ 6.012,73 - Salário"), line(100, "x")).formula,
    ).toBe("=SUM(6012,73+1\n)");
    expect(
      plan(sumCell("=SUM(1006,51\n+5,89)", 1012.4, "R$ 1006,51 - A\nR$ 5,89 - B"), line(100, "x"))
        .formula,
    ).toBe("=SUM(1006,51\n+5,89+1)");
  });

  it("puts a line with no section above the first header", () => {
    const note = "R$ 9,99 - Seguro\nR$ 15,00 - Jogo\n\nCONTAS\nR$ 73,28 - Telefone";
    const p = plan(sumCell("=SUM(9,99+15+73,28)", 98.27, note), line(4240, "Restaurante"));
    expect(p.note).toBe(
      "R$ 9,99 - Seguro\nR$ 15,00 - Jogo\nR$ 42,40 - Restaurante\n\nCONTAS\nR$ 73,28 - Telefone",
    );
    const onlyHeader = plan(sumCell("=SUM(50)", 50, "CONTAS\nR$ 50,00 - Luz"), line(100, "x"));
    expect(onlyHeader.note).toBe("R$ 1,00 - x\n\nCONTAS\nR$ 50,00 - Luz");
  });

  it("puts a line at the end of its section, even with a blank line under the header", () => {
    const note =
      "CONTAS\n\nR$ 1.484,74 - Aluguel\nR$ 430,61 - Curso\n\nCARTÕES\n\nR$ 209,44 - Banco B";
    const p = plan(
      sumCell("=SUM(1484,74+430,61+209,44)", 2124.79, note),
      line(21543, "Luz", "contas"),
    );
    expect(p.note).toBe(
      "CONTAS\n\nR$ 1.484,74 - Aluguel\nR$ 430,61 - Curso\nR$ 215,43 - Luz\n\nCARTÕES\n\nR$ 209,44 - Banco B",
    );
    expect(p.after).toBe(cents(234022));
  });

  it("creates the section at the end when the note has none", () => {
    const p = plan(
      sumCell("=SUM(80)", 80, "R$ 80,00 - Carona"),
      line(30639, "Previdência", "investimento"),
    );
    expect(p.note).toBe("R$ 80,00 - Carona\n\nInvestimento:\nR$ 306,39 - Previdência");
    expect(plan(undefined, line(50000, "Reserva", "reserva")).note).toBe(
      "Reserva:\nR$ 500,00 - Reserva",
    );
  });

  it("finds sections written in other ways (CONTAS:, Investimentos)", () => {
    const p = plan(
      sumCell(
        "=SUM(306,39+232\n)",
        538.39,
        "Investimento:\nR$ 306,39 - Previdência\n\nCONTAS:\nR$ 232,00 - Curso",
      ),
      line(1000, "Luz", "contas"),
    );
    expect(p.note).toBe(
      "Investimento:\nR$ 306,39 - Previdência\n\nCONTAS:\nR$ 232,00 - Curso\nR$ 10,00 - Luz",
    );
    expect(p.formula).toBe("=SUM(306,39+232+10\n)");
  });
});

describe("planCellEdit: a card purchase", () => {
  const bill = "CARTÕES\n\nR$ 3.616,00 - Banco A Pessoa 1\nR$ 2.040,55 - Banco A Pessoa 2";

  it("raises the card's line and its term, nothing else", () => {
    const p = plan(sumCell("=SUM(3616+2040,55)", 5656.55, bill), card(4240, "Banco A Pessoa 1"));
    expect(p.formula).toBe("=SUM(3658,4+2040,55)");
    expect(p.note).toBe(
      "CARTÕES\n\nR$ 3.658,40 - Banco A Pessoa 1\nR$ 2.040,55 - Banco A Pessoa 2",
    );
    expect([p.before, p.after]).toEqual([565655, 569895]);
  });

  it("keeps the owner's spacing and spelling on the card line", () => {
    const p = plan(
      sumCell("=SUM(209,44+251,12)", 460.56, "CARTÕES\n\nR$ 209,44 -  Itaú\nR$ 251,12 - Loja"),
      card(56, "itau"),
    );
    expect(p.note).toBe("CARTÕES\n\nR$ 210,00 -  Itaú\nR$ 251,12 - Loja");
    expect(p.formula).toBe("=SUM(210+251,12)");
  });

  it("fills a zero bill line, adding the term the formula did not have", () => {
    const p = plan(
      sumCell("=SUM(215,43)", 215.43, "CONTAS\nR$ 215,43 - Luz\n\nFATURAS:\nR$ 0,00 - Banco X"),
      card(1990, "Banco X"),
    );
    expect(p.note).toBe("CONTAS\nR$ 215,43 - Luz\n\nFATURAS:\nR$ 19,90 - Banco X");
    expect(p.formula).toBe("=SUM(215,43+19,9)");
  });

  it("adds a card line under CARTÕES when the bill has none yet", () => {
    const p = plan(
      sumCell("=SUM(1484,74)", 1484.74, "CONTAS\nR$ 1.484,74 - Aluguel"),
      card(9999, "Banco B"),
    );
    expect(p.note).toBe("CONTAS\nR$ 1.484,74 - Aluguel\n\nCARTÕES\nR$ 99,99 - Banco B");
    expect(plan(undefined, card(9999, "Banco B")).note).toBe("CARTÕES\nR$ 99,99 - Banco B");
  });

  it("does not take a same-named line outside a card section", () => {
    const p = plan(sumCell("=SUM(50)", 50, "R$ 50,00 - Banco B"), card(100, "Banco B"));
    expect(p.note).toBe("R$ 50,00 - Banco B\n\nCARTÕES\nR$ 1,00 - Banco B");
  });

  it("refuses a bill with two lines for the same card", () => {
    const r = planCellEdit(
      sumCell("=SUM(10+20)", 30, "CARTÕES\nR$ 10,00 - Banco B\nR$ 20,00 - banco b"),
      card(100, "Banco B"),
    );
    expect(r).toMatchObject({ ok: false });
  });
});

const change = (
  was: number,
  amount: number,
  description: string,
  section: string | null = null,
): EditOp => ({ was: cents(was), amount: cents(amount), description, section, target: "line" });
const setCard = (was: number, amount: number, description: string): EditOp => ({
  ...card(amount, description),
  was: cents(was),
});

describe("planCellEdit: changing a line already there", () => {
  const salary = "R$ 9.000,00 - Salário\nR$ 50,00 - Rendimento";

  it("gives a line a new value, keeping its text and the other lines", () => {
    const p = plan(sumCell("=SUM(9000+50)", 9050, salary), change(900000, 912345, "salário"));
    expect(p.formula).toBe("=SUM(9123,45+50)");
    expect(p.note).toBe("R$ 9.123,45 - Salário\nR$ 50,00 - Rendimento");
    expect([p.before, p.after]).toEqual([905000, 917345]);
  });

  it("removes a line and its term", () => {
    const p = plan(sumCell("=SUM(9000+50)", 9050, salary), change(5000, 0, "Rendimento"));
    expect(p.formula).toBe("=SUM(9000)");
    expect(p.note).toBe("R$ 9.000,00 - Salário");
    expect(p.after).toBe(900000);
  });

  it("empties the cell when the last line goes", () => {
    const p = plan(sumCell("=SUM(42,4)", 42.4, "R$ 42,40 - Padaria"), change(4240, 0, "Padaria"));
    expect([p.formula, p.note, p.after]).toEqual(["", "", 0]);
    const n = plan(
      {
        userEnteredValue: { numberValue: 20 },
        effectiveValue: { numberValue: 20 },
        note: "R$ 20,00 - x",
      },
      change(2000, 0, "x"),
    );
    expect([n.formula, n.note]).toEqual(["", ""]);
  });

  it("drops a section header left with no lines, and the blank line before it", () => {
    const p = plan(
      sumCell("=SUM(100+215,43)", 315.43, "R$ 100,00 - Mercado\n\nCONTAS\nR$ 215,43 - Luz"),
      change(21543, 0, "Luz", "contas"),
    );
    expect(p.note).toBe("R$ 100,00 - Mercado");
    expect(p.formula).toBe("=SUM(100)");
    const q = plan(
      sumCell("=SUM(215,43+50)", 265.43, "CONTAS\nR$ 215,43 - Luz\n\nCARTÕES\nR$ 50,00 - Banco X"),
      change(21543, 0, "Luz", "contas"),
    );
    expect(q.note).toBe("CARTÕES\nR$ 50,00 - Banco X");
  });

  it("only takes the line in its own section, with the value it was seen with", () => {
    const cell = sumCell("=SUM(10+10)", 20, "R$ 10,00 - Luz\n\nCONTAS\nR$ 10,00 - Luz");
    expect(plan(cell, change(1000, 1500, "Luz", "contas")).note).toBe(
      "R$ 10,00 - Luz\n\nCONTAS\nR$ 15,00 - Luz",
    );
    expect(planCellEdit(cell, change(1100, 1500, "Luz", "contas"))).toMatchObject({ ok: false });
    expect(planCellEdit(cell, change(1000, 1500, "Água"))).toMatchObject({ ok: false });
  });

  it("sets a card line to the bill's total, lower or higher, and creates it when missing", () => {
    const bill = sumCell("=SUM(410+20)", 430, "CARTÕES\nR$ 410,00 - Inter\nR$ 20,00 - Itaú");
    expect(plan(bill, setCard(41000, 45290, "Inter")).note).toBe(
      "CARTÕES\nR$ 452,90 - Inter\nR$ 20,00 - Itaú",
    );
    expect(plan(bill, setCard(41000, 40999, "Inter")).formula).toBe("=SUM(409,99+20)");
    const zero = plan(bill, setCard(2000, 0, "Itaú"));
    expect([zero.formula, zero.note]).toEqual([
      "=SUM(410)",
      "CARTÕES\nR$ 410,00 - Inter\nR$ 0,00 - Itaú",
    ]);
    expect(plan(bill, setCard(0, 1000, "Nubank")).note).toBe(
      "CARTÕES\nR$ 410,00 - Inter\nR$ 20,00 - Itaú\nR$ 10,00 - Nubank",
    );
  });

  it("refuses when the card line no longer holds what was seen", () => {
    const bill = sumCell("=SUM(410)", 410, "CARTÕES\nR$ 410,00 - Inter");
    expect(planCellEdit(bill, setCard(40000, 45290, "Inter"))).toMatchObject({ ok: false });
    expect(planCellEdit(bill, setCard(41000, 41000, "Inter"))).toMatchObject({ ok: false });
  });
});

describe("planCellEdit: the Diário previsto", () => {
  it("fills a free Diário, the literal 0 included, with the forecast line", () => {
    const p = plan(
      { userEnteredValue: { numberValue: 0 }, effectiveValue: { numberValue: 0 } },
      line(4500, "Previsto"),
    );
    expect(p).toMatchObject({
      formula: "=SUM(45)",
      note: "R$ 45,00 - Previsto",
      before: 0,
      after: 4500,
    });
  });
  it("takes the forecast off when a real spending lands on the day", () => {
    const p = plan(sumCell("=SUM(45)", 45, "R$ 45,00 - Previsto"), {
      ...line(3000, "Padaria"),
      dropForecast: true,
    });
    expect(p).toMatchObject({
      formula: "=SUM(30)",
      note: "R$ 30,00 - Padaria",
      before: 4500,
      after: 3000,
    });
  });
  it("keeps what the owner wrote beside the forecast", () => {
    const p = plan(sumCell("=SUM(45+12)", 57, "R$ 45,00 - Previsto\nR$ 12,00 - Café"), {
      ...line(3000, "Padaria"),
      dropForecast: true,
    });
    expect(p).toMatchObject({
      formula: "=SUM(12+30)",
      note: "R$ 12,00 - Café\nR$ 30,00 - Padaria",
      before: 5700,
      after: 4200,
    });
  });
  it("adds as usual on a day without forecast, and leaves the forecast without the flag", () => {
    expect(
      plan(sumCell("=SUM(12)", 12, "R$ 12,00 - Café"), {
        ...line(3000, "Padaria"),
        dropForecast: true,
      }),
    ).toMatchObject({ after: 4200 });
    expect(
      plan(sumCell("=SUM(45)", 45, "R$ 45,00 - Previsto"), line(3000, "Padaria")),
    ).toMatchObject({ after: 7500 });
  });
  it("changes and removes the forecast like any line", () => {
    expect(
      plan(sumCell("=SUM(45)", 45, "R$ 45,00 - Previsto"), {
        ...line(5000, "Previsto"),
        was: cents(4500),
      }),
    ).toMatchObject({ formula: "=SUM(50)", note: "R$ 50,00 - Previsto" });
    expect(
      plan(sumCell("=SUM(45)", 45, "R$ 45,00 - Previsto"), {
        ...line(0, "Previsto"),
        was: cents(4500),
      }),
    ).toMatchObject({ formula: "", note: "", after: 0 });
  });
});

describe("planCellEdit: refusals", () => {
  it("never edits a cell it does not understand, and never takes bad input", () => {
    expect(planCellEdit(sumCell("=SUM(10+10)", 20, "R$ 20,00 - x"), line(100, "y")).ok).toBe(false);
    expect(planCellEdit(undefined, line(0, "y")).ok).toBe(false);
    expect(planCellEdit(undefined, line(100, "   ")).ok).toBe(false);
    expect(planCellEdit(undefined, line(100, "R$ 5,00 - truque")).ok).toBe(false);
  });
  it("folds line breaks in the description into one line", () => {
    expect(plan(undefined, line(100, "a\nR$ 1,00 - b")).note).toBe("R$ 1,00 - a R$ 1,00 - b");
  });
});

/** Small seeded generator (mulberry32), as in the engine's property tests. */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("properties", () => {
  it("an edit keeps every old line, adds exactly the entry and the cell stays consistent", () => {
    const r = rng(7);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)] as T;
    const sections = [null, "contas", "cartoes", "investimento", "reserva"] as const;
    const headerText: Record<string, string> = {
      contas: pick(["CONTAS", "CONTAS:", "Contas:"]),
      cartoes: pick(["CARTÕES", "CARTÕES:", "FATURAS:"]),
      investimento: pick(["Investimento:", "INVESTIMENTOS"]),
      reserva: "Reserva:",
    };
    for (let run = 0; run < 400; run++) {
      // A random clean cell: lines grouped by section, terms in a shuffled order.
      const items: { amount: number; description: string; section: string | null }[] = [];
      const n = Math.floor(r() * 6);
      for (let i = 0; i < n; i++)
        items.push({
          amount: 1 + Math.floor(r() * 500_000),
          description: `Item ${i}`,
          section: pick(sections),
        });
      const bySection = (s: string | null) => items.filter((i) => i.section === s);
      const blocks = [
        bySection(null)
          .map((i) => `${noteAmount(cents(i.amount))} - ${i.description}`)
          .join("\n"),
        ...sections
          .filter((s): s is Exclude<typeof s, null> => s !== null)
          .filter((s) => bySection(s).length > 0)
          .map((s) =>
            [
              headerText[s],
              ...bySection(s).map((i) => `${noteAmount(cents(i.amount))} - ${i.description}`),
            ].join("\n"),
          ),
      ].filter((b) => b !== "");
      const note = blocks.join(pick(["\n\n", "\n"]));
      const ordered = [...items].sort(() => r() - 0.5);
      const total = items.reduce((a, i) => a + i.amount, 0);
      const cell: ApiCell | undefined =
        n === 0
          ? undefined
          : sumCell(
              `=SUM(${ordered.map((i) => formulaTerm(cents(i.amount))).join(pick(["+", "\n+"]))})`,
              total / 100,
              note,
            );
      const isCard = r() < 0.4;
      const amount = 1 + Math.floor(r() * 300_000);
      const op: EditOp = isCard
        ? card(amount, pick(["Item 0", "Item 1", "Cartão Novo"]))
        : line(amount, "Novo", pick(sections));

      const p = planCellEdit(cell, op);
      if (!p.ok) {
        // Only refusal allowed here: two card lines with the same name do not happen above.
        throw new Error(`refused a clean cell: ${p.reason}\n${note}`);
      }
      expect(p.before).toBe(total);
      expect(p.after).toBe(total + amount);
      const before = parseNote(note).items;
      const after = parseNote(p.note).items;
      expect(parseNote(p.note).unparsed).toEqual([]);
      const sum = (xs: readonly { amount: number }[]) => xs.reduce((a, i) => a + i.amount, 0);
      expect(sum(after)).toBe(total + amount);
      // Every old line is still there, with the same text, except the one card line raised.
      const changed = after.filter(
        (a) =>
          !before.some(
            (b) =>
              b.amount === a.amount && b.description === a.description && b.section === a.section,
          ),
      );
      expect(changed).toHaveLength(1);
      expect(after.length - before.length).toBe(changed[0]?.amount === amount ? 1 : 0);
      expect(
        checkCell({
          userEnteredValue: { formulaValue: p.formula },
          effectiveValue: { numberValue: p.after / 100 },
          note: p.note,
        }).ok,
      ).toBe(true);
    }
  });

  it("a change touches exactly one line, and the cell stays consistent", () => {
    const r = rng(11);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)] as T;
    const headers: Record<string, string> = { contas: "CONTAS", cartoes: "CARTÕES" };
    for (let run = 0; run < 400; run++) {
      const items = Array.from({ length: 1 + Math.floor(r() * 5) }, (_, i) => ({
        amount: 1 + Math.floor(r() * 500_000),
        description: `Item ${i}`,
        section: pick([null, "contas", "cartoes"] as const),
      }));
      const block = (s: string | null) =>
        items
          .filter((i) => i.section === s)
          .map((i) => `${noteAmount(cents(i.amount))} - ${i.description}`);
      const note = [
        block(null).join("\n"),
        ...(["contas", "cartoes"] as const)
          .filter((s) => block(s).length > 0)
          .map((s) => [headers[s], ...block(s)].join("\n")),
      ]
        .filter((b) => b !== "")
        .join(pick(["\n\n", "\n"]));
      const total = items.reduce((a, i) => a + i.amount, 0);
      const terms = [...items].sort(() => r() - 0.5).map((i) => formulaTerm(cents(i.amount)));
      const cell = sumCell(`=SUM(${terms.join(pick(["+", "\n+"]))})`, total / 100, note);
      const target = pick(items);
      const to = r() < 0.4 ? 0 : 1 + Math.floor(r() * 500_000);
      if (to === target.amount) continue;
      const p = plan(
        cell,
        target.section === "cartoes"
          ? setCard(target.amount, to, target.description)
          : change(target.amount, to, target.description, target.section),
      );
      expect(p.after).toBe(total - target.amount + to);
      const after = parseNote(p.note).items;
      for (const i of items.filter((x) => x !== target))
        expect(after).toContainEqual({ ...i, amount: cents(i.amount) });
      const kept = after.find((i) => i.description === target.description);
      if (to === 0 && target.section !== "cartoes") expect(kept).toBeUndefined();
      else expect(kept?.amount).toBe(to);
      const reread = checkCell(
        p.formula === ""
          ? { note: p.note }
          : {
              userEnteredValue: { formulaValue: p.formula },
              effectiveValue: { numberValue: p.after / 100 },
              note: p.note,
            },
      );
      expect(reread).toMatchObject({ ok: true, total: p.after });
    }
  });
});

describe("planEconomiaEdit", () => {
  const num = (n: number) => ({
    userEnteredValue: { numberValue: n },
    effectiveValue: { numberValue: n },
  });
  const fx = (f: string, n: number) => ({
    userEnteredValue: { formulaValue: f },
    effectiveValue: { numberValue: n },
  });

  it("keeps the month's Economia as the method does: =500+500-300", () => {
    const first = planEconomiaEdit(num(0), { amount: cents(50000), column: "saida" });
    expect(first).toMatchObject({ ok: true, formula: "=500", before: 0, after: 50000 });
    const second = planEconomiaEdit(fx("=500", 500), { amount: cents(50000), column: "saida" });
    expect(second).toMatchObject({ formula: "=500+500", after: 100000 });
    const back = planEconomiaEdit(fx("=500+500", 1000), {
      amount: cents(30050),
      column: "entrada",
    });
    expect(back).toMatchObject({ formula: "=500+500-300,5", before: 100000, after: 69950 });
    expect(planEconomiaEdit(undefined, { amount: cents(100), column: "saida" })).toMatchObject({
      formula: "=1",
    });
    expect(planEconomiaEdit(num(250), { amount: cents(100), column: "saida" })).toMatchObject({
      formula: "=250+1",
      after: 25100,
    });
  });

  it("leaves alone a cell it does not fully understand", () => {
    const refuse = (c: unknown) =>
      expect(planEconomiaEdit(c as never, { amount: cents(100), column: "saida" }).ok).toBe(false);
    refuse(fx("=SUM(A1:A3)", 10));
    refuse(fx("=500+500", 999));
    refuse({ userEnteredValue: { stringValue: "x" } });
  });
});
