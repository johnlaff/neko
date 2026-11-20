import type { LocalDate, SubscriptionNews, WatchNews } from "@neko/engine";
import { cents } from "@neko/engine";
import { describe, expect, it } from "vitest";
import { daysText, miaNote } from "../src/shared/note.ts";
import type { Mia2Rotina, ProjectionResponse } from "../src/shared/types.ts";
import { loadSeen, markSeen, noteFor } from "../src/worker/note.ts";
import { sqliteD1 } from "./d1.ts";

const d = (s: string) => s as LocalDate;
const repeat: WatchNews = {
  kind: "repetida",
  key: "repetida|petzloja|8990|cartao azul|2026-11-18",
  description: "PETZ LOJA 12",
  card: "Cartão Azul",
  amount: cents(89_90),
  dates: [d("2026-11-18"), d("2026-11-19")],
  date: d("2026-11-19"),
  dispute: false,
};
const refund: WatchNews = {
  kind: "estorno",
  key: "estorno|petzdigital|7566|cartao azul|2026-11-18",
  description: "PETZ DIGITAL",
  card: "Cartão Azul",
  amount: cents(75_66),
  dates: [d("2026-11-18")],
  date: d("2026-11-18"),
  dispute: false,
};
const dispute: WatchNews = {
  ...refund,
  key: "estorno|credemcccontestacao|15990|cartao azul|2026-11-17",
  description: "CRED EM C/C CONTESTACAO",
  amount: cents(159_90),
  dates: [d("2026-11-17")],
  date: d("2026-11-17"),
  dispute: true,
};
const nova: SubscriptionNews = {
  kind: "nova",
  key: "nova|academiacentral|14990|cartao azul",
  description: "ACADEMIA CENTRAL",
  card: "Cartão Azul",
  amount: cents(149_90),
  before: null,
  since: d("2026-10-17"),
  date: d("2026-11-17"),
};
const subiu: SubscriptionNews = {
  kind: "subiu",
  key: "subiu|netflixcom|4490|cartao azul",
  description: "NETFLIX.COM",
  card: "Cartão Azul",
  amount: cents(44_90),
  before: cents(39_90),
  since: d("2026-07-15"),
  date: d("2026-11-15"),
};
const rotina: Mia2Rotina = {
  id: "semana:2026-11-15",
  tipo: "semana",
  titulo: "Semana de 8 a 14 nov",
  dia: "2026-11-15",
  sessao: "sesn_abc12345",
  partes: [
    {
      t: "mensagem",
      id: "m1",
      texto:
        "**Cartões e Pix levaram R$ 812,40** na semana, R$ 95,00 a menos que na anterior.\n- Item",
      valores: {},
    },
  ],
};
const none = { watch: [], subscriptions: [], rotina: null, seen: [], mia: true };

describe("Mia's line on Hoje", () => {
  it("leads with a charge that came twice, in words, and asks Mia on a tap", () => {
    expect(miaNote({ ...none, watch: [refund, repeat], subscriptions: [nova], rotina })).toEqual({
      id: "vigia:repetida|petzloja|8990|cartao azul|2026-11-18",
      tipo: "vigia",
      titulo: "Cobrança repetida",
      texto:
        "Petz Loja 12 cobrou R$ 89,90 duas vezes no Cartão Azul, em 18 e 19 nov. Se foi uma compra só, conteste no banco.",
      pergunta: "O que eu faço com a cobrança repetida de Petz Loja 12?",
      abre: "mia",
    });
  });

  it("goes on to subscriptions, refunds and her routine as each is seen", () => {
    const seen: string[] = [];
    const next = () =>
      miaNote({ watch: [refund, dispute], subscriptions: [nova, subiu], rotina, seen, mia: true });
    const texts: (string | undefined)[] = [];
    for (let n = next(); n; n = next()) {
      texts.push(`${n.titulo}: ${n.texto}`);
      seen.push(n.id);
    }
    expect(texts).toEqual([
      "Assinatura nova: Academia Central cobrou R$ 149,90 no Cartão Azul em 17 out e 17 nov. Não reconhece? Conteste no banco.",
      "Assinatura mais cara: Netflix.com passou de R$ 39,90 para R$ 44,90 por mês no Cartão Azul.",
      "Estorno: Petz Digital devolveu R$ 75,66 no Cartão Azul, em 18 nov.",
      "Contestação: O banco devolveu R$ 159,90 de uma contestação no Cartão Azul, em 17 nov.",
      "Semana de 8 a 14 nov: Cartões e Pix levaram R$ 812,40 na semana, R$ 95,00 a menos que na anterior.",
    ]);
  });

  it("opens her routine on her screen, and Faturas while Mia is off", () => {
    expect(miaNote({ ...none, rotina })).toMatchObject({
      id: "rotina:semana:2026-11-15",
      tipo: "rotina",
      pergunta: null,
      abre: "mia",
    });
    expect(miaNote({ ...none, watch: [refund], mia: false })).toMatchObject({
      pergunta: null,
      abre: "faturas",
    });
    expect(miaNote(none)).toBeNull();
  });

  it("says the days of a charge with the month once", () => {
    expect(daysText(["2026-11-18"])).toBe("18 nov");
    expect(daysText(["2026-11-19", "2026-11-18", "2026-11-18"])).toBe("18 e 19 nov");
    expect(daysText(["2026-11-17", "2026-11-18", "2026-11-19"])).toBe("17, 18 e 19 nov");
    expect(daysText(["2026-11-30", "2026-12-01"])).toBe("30 nov e 1 dez");
  });

  it("keeps what was tapped or dismissed, for every device", async () => {
    const db = sqliteD1() as unknown as D1Database;
    const data = {
      bank: { watch: [repeat], subscriptions: { items: [], total: 0, toCancel: 0, news: [] } },
    } as unknown as ProjectionResponse;
    expect((await noteFor(db, data, { on: true, rotina: null }))?.tipo).toBe("vigia");
    await markSeen(db, "vigia:repetida|petzloja|8990|cartao azul|2026-11-18");
    await markSeen(db, "vigia:repetida|petzloja|8990|cartao azul|2026-11-18");
    expect(await loadSeen(db)).toEqual(["vigia:repetida|petzloja|8990|cartao azul|2026-11-18"]);
    expect(await noteFor(db, data, { on: true, rotina })).toMatchObject({ tipo: "rotina" });
  });
});
