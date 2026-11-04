import { describe, expect, it } from "vitest";
import type { StatementAnswer } from "../src/shared/types.ts";
import type { Env } from "../src/worker/env.ts";
import { allowedSender, receiveEmail } from "../src/worker/inbox.ts";

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
    expect(allowedSender("faturas@bradesco.com.br.golpe.com", [OWNER])).toBe(false);
    expect(allowedSender("alguem@example.com", [OWNER])).toBe(false);
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
