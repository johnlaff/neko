import { localDate } from "@neko/engine";
import { describe, expect, it } from "vitest";
import type { StatementAnswer } from "../src/shared/types.ts";
import type { Env } from "../src/worker/env.ts";
import { allowedSender, mailedBill, receiveEmail } from "../src/worker/inbox.ts";
import { sqliteD1 } from "./d1.ts";

// Invented addresses (public repo).
const OWNER = "dono@example.com";
const PDF = btoa("%PDF-1.7 fatura inventada");

const mime = (from: string, attachment: boolean) =>
  [
    `From: ${from}`,
    "To: fatura@neko.example",
    "Subject: Sua fatura chegou",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b"',
    "",
    "--b",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Segue a fatura.",
    ...(attachment
      ? [
          "--b",
          'Content-Type: application/pdf; name="fatura.pdf"',
          "Content-Transfer-Encoding: base64",
          'Content-Disposition: attachment; filename="fatura.pdf"',
          "",
          PDF,
        ]
      : []),
    "--b--",
    "",
  ].join("\r\n");

const message = (from: string, attachment = true) => {
  const rejected: string[] = [];
  return {
    rejected,
    from,
    raw: new Response(mime(from, attachment)).body as ReadableStream<Uint8Array>,
    setReject: (reason: string) => {
      rejected.push(reason);
    },
  };
};

const env = { ALLOWED_EMAILS: ` ${OWNER} ,outro@example.com` } as unknown as Env;

const taker = () => {
  const taken: unknown[] = [];
  const take = async (_env: Env, body: unknown): Promise<StatementAnswer> => {
    taken.push(body);
    return { read: true, due: "2026-12-12", cards: 2, lines: 10, added: [] };
  };
  return { taken, take };
};

describe("fatura@: the bill by e-mail", () => {
  it("takes the bank and the owner's own forwarding, nobody else", () => {
    expect(allowedSender("Dono@Example.com", [OWNER])).toBe(true);
    expect(allowedSender("faturas@cartoes.bradesco.com.br", [OWNER])).toBe(true);
    expect(allowedSender("faturabradescard@infobradesco.com.br", [OWNER])).toBe(true);
    expect(allowedSender("todomundo@nubank.com.br", [OWNER])).toBe(true);
    expect(allowedSender("faturas@bradesco.com.br.golpe.com", [OWNER])).toBe(false);
    expect(allowedSender("faturas@golpeinfobradesco.com.br", [OWNER])).toBe(false);
    expect(allowedSender("alguem@example.com", [OWNER])).toBe(false);
  });

  it("takes the owner's Gmail filter, which forwards with a tagged sender", () => {
    expect(allowedSender("dono+caf_=fatura=neko.example@example.com", [OWNER])).toBe(true);
    expect(allowedSender("outro+caf_=fatura=neko.example@example.com", [OWNER])).toBe(false);
  });

  it("reads each PDF attached, as one sent from Faturas", async () => {
    const { taken, take } = taker();
    const m = message(OWNER);
    await receiveEmail(m, env, take);
    expect(taken).toEqual([{ pdf: PDF }]);
    expect(m.rejected).toEqual([]);
  });

  it("refuses a stranger and reads nothing", async () => {
    const { taken, take } = taker();
    const m = message("alguem@example.com");
    await receiveEmail(m, env, take);
    expect(taken).toEqual([]);
    expect(m.rejected).toHaveLength(1);
  });

  it("reads nothing from an e-mail without a PDF, or from Gmail's forwarding check", async () => {
    const { taken, take } = taker();
    await receiveEmail(message(OWNER, false), env, take);
    await receiveEmail(message("forwarding-noreply@google.com"), env, take);
    expect(taken).toEqual([]);
  });
});

// A card bank outside Open Finance (Nubank) writes the closed bill's total in the e-mail itself.
const closingMime = (from: string, html: string) =>
  [
    `From: ${from}`,
    "To: fatura@neko.example",
    "Subject: Sua fatura fechou",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b"',
    "",
    "--b",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "--b",
    'Content-Type: application/pdf; name="fatura.pdf"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="fatura.pdf"',
    "",
    PDF,
    "--b--",
    "",
  ].join("\r\n");

const CLOSED =
  "<div><strong>Olá, Fulano.</strong><br><br>A fatura do seu cartão de crédito Nubank com vencimento no dia 2 de dezembro fechou no valor de R$&nbsp;1.234,56.<br><br>O pagamento já está agendado.</div>";

describe("fatura@: a bill that comes as the e-mail's own words", () => {
  const today = localDate("2026-11-25");

  it("reads the card, the due day and the total, in the year closest to the day it came", () => {
    expect(mailedBill(CLOSED, today)).toEqual({ card: "Nubank", due: "2026-12-02", total: 123456 });
    const january = CLOSED.replace("2 de dezembro", "2 de janeiro").replace("1.234,56", "4,08");
    expect(mailedBill(january, localDate("2026-12-27"))).toEqual({
      card: "Nubank",
      due: "2027-01-02",
      total: 408,
    });
    // Accents written as HTML entities read the same.
    const encoded = CLOSED.replace("cartão de crédito", "cart&atilde;o de cr&eacute;dito").replace(
      "2 de dezembro",
      "10 de mar&ccedil;o",
    );
    expect(mailedBill(encoded, localDate("2027-02-28"))).toEqual({
      card: "Nubank",
      due: "2027-03-10",
      total: 123456,
    });
    expect(mailedBill("Segue a fatura.", today)).toBeNull();
  });

  it("keeps it without reading the PDF, and a later e-mail for the same bill replaces it", async () => {
    const db = sqliteD1();
    const { taken, take } = taker();
    const send = (html: string) => ({
      from: "todomundo@nubank.com.br",
      raw: new Response(closingMime("todomundo@nubank.com.br", html))
        .body as ReadableStream<Uint8Array>,
      setReject: () => {},
    });
    const withDb = { ...env, DB: db } as unknown as Env;
    const now = new Date("2026-11-25T12:00:00Z");
    await receiveEmail(send(CLOSED), withDb, take, now);
    await receiveEmail(send(CLOSED.replace("1.234,56", "1.300,00")), withDb, take, now);
    expect(taken).toEqual([]);
    expect(db.sqlite.prepare("SELECT card, due_date, total FROM mailed_bill").all()).toEqual([
      { card: "Nubank", due_date: "2026-12-02", total: 130000 },
    ]);
  });
});
