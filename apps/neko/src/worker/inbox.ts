import {
  type Cents,
  cents,
  clampedDay,
  diffDays,
  type LocalDate,
  localDate,
  parts,
  todayIn,
} from "@neko/engine";
import PostalMime from "postal-mime";
import type { StatementAnswer } from "../shared/types.ts";
import type { Env } from "./env.ts";
import { finishSignIn, signInLink } from "./meupluggy.ts";
import type { Fetch } from "./pluggy.ts";
import { takeStatement } from "./statement.ts";

/**
 * fatura@ on the Neko domain (Cloudflare Email Routing sends it to this Worker): the bank's bill
 * PDF, straight from the bank or forwarded by the owner's mail filter, read like one sent from
 * Faturas, and the bills of the billers the owner set (light, phone), kept for Para lançar.
 * Anyone else's mail is refused; nothing here reaches the sheet.
 */

/** The banks whose bills are taken as they arrive. */
const BANKS = /@(?:[a-z0-9-]+\.)*(?:bradesco|infobradesco|bradescard|nubank)\.com\.br$/i;

/** Gmail's sender for the code that confirms a forwarding address. */
const GMAIL_FORWARDING = "forwarding-noreply@google.com";

/** Meu Pluggy's sign-in e-mail, forwarded by the owner's filter (meupluggy.ts). */
const MEU_PLUGGY = "no-reply@pluggy.ai";

/** A Gmail filter forwards with the owner's address tagged, as in dono+caf_=fatura=…@gmail.com. */
const untagged = (address: string) => address.replace(/\+[^@]*@/, "@");

/** The domain of an address, lowercase; "" for none. */
const domainOf = (address: string) => address.trim().toLowerCase().split("@")[1] ?? "";

/**
 * The biller behind an address, among the domains the owner set (BILL_SENDERS, a secret: who the
 * owner pays for light and phone says where he lives), named by its domain: contas@luz.com.br
 * reads "Luz". Null for any other sender.
 */
export const billerOf = (from: string, billers: readonly string[]): string | null => {
  const domain = domainOf(from);
  const set = billers.find((b) => domain === b || domain.endsWith(`.${b}`));
  const name = set?.split(".")[0];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : null;
};

export const allowedSender = (
  from: string,
  owners: readonly string[],
  billers: readonly string[] = [],
): boolean => {
  const address = from.trim().toLowerCase();
  return (
    owners.includes(untagged(address)) || BANKS.test(address) || billerOf(address, billers) !== null
  );
};

const MONTHS = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** The words of an e-mail body: tags out, accents and entities folded to plain letters. */
const words = (body: string) =>
  body
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&([a-z])(?:acute|grave|tilde|circ|cedil|uml);/gi, "$1")
    .replace(/&nbsp;|&#160;/gi, " ")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");

/**
 * A closed bill as the bank words it in the e-mail, for a card outside Open Finance: "A fatura do
 * seu cartão de crédito Nubank com vencimento no dia 2 de dezembro fechou no valor de R$ 1.234,56".
 * The year is the one that puts the due date closest to the day the e-mail came.
 */
export const mailedBill = (
  body: string,
  today: LocalDate,
): { card: string; due: LocalDate; total: Cents } | null => {
  const m =
    /cartao de credito (\S+) com vencimento no dia (\d{1,2}) de ([a-z]+) fechou no valor de R\$ ?([\d.]+,\d{2})\b/i.exec(
      words(body),
    );
  const month = MONTHS.indexOf(m?.[3]?.toLowerCase() ?? "") + 1;
  if (!m?.[1] || !m[4] || month === 0) return null;
  const { year } = parts(today);
  const [due] = [year - 1, year, year + 1]
    .map((y) => clampedDay(y, month, Number(m[2])))
    .sort((a, b) => Math.abs(diffDays(a, today)) - Math.abs(diffDays(b, today)));
  if (!due) return null;
  return { card: m[1], due, total: cents(Number(m[4].replace(/\D/g, ""))) };
};

/**
 * A biller's bill as its e-mail words it: the due day and the value, in either order, as "Data de
 * vencimento: 01/12/2026" and "Valor da fatura: R$ 62,50" or "TOTAL A PAGAR 62,50". A notice with
 * no due day (a reminder of what is late) is not a bill.
 */
export const mailedConta = (body: string): { due: LocalDate; total: Cents } | null => {
  const text = words(body);
  const due = /vencimento\W{0,5}(\d{2})\/(\d{2})\/(\d{4})\b/i.exec(text);
  const total =
    /(?:valor (?:da fatura|da conta|a pagar|total)|total a pagar)\W{0,5}(?:R\$\s?)?([\d.]+,\d{2})\b/i.exec(
      text,
    );
  if (!due || !total?.[1]) return null;
  const [, d = "", m = "", y = ""] = due;
  try {
    return {
      due: localDate(`${y}-${m}-${d}`),
      total: cents(Number(total[1].replace(/\D/g, ""))),
    };
  } catch {
    return null;
  }
};

/** Forwarded by hand, a bill's sender is in the header the forward quotes: "De: Luz <contas@luz.com.br>". */
const forwardedFrom = (text: string): string =>
  /^\s*(?:from|de):[^\n@]*?<?([^\s<>@]+@[^\s<>]+?)>?\s*$/im.exec(text)?.[1] ?? "";

/** What the e-mail handler needs: the message's sender and bytes, and a way to refuse it. */
export interface InboxMessage {
  readonly from: string;
  readonly raw: ReadableStream<Uint8Array>;
  setReject(reason: string): void;
}

export const receiveEmail = async (
  message: InboxMessage,
  env: Env,
  take: (env: Env, body: unknown) => Promise<StatementAnswer> = takeStatement,
  now = new Date(),
  /** After a Meu Pluggy sign-in finishes here, `signedIn` refreshes the banks. */
  meuPluggy: { readonly fetch?: Fetch; readonly signedIn?: () => void } = {},
): Promise<void> => {
  const from = message.from.trim().toLowerCase();
  const list = (value: string | undefined) =>
    (value ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  const owners = list(env.ALLOWED_EMAILS);
  const billers = list(env.BILL_SENDERS);
  const mail = await PostalMime.parse(await new Response(message.raw).arrayBuffer(), {
    attachmentEncoding: "base64",
  });
  if (from === GMAIL_FORWARDING) {
    // Adding fatura@ as a forwarding address in Gmail sends a link here; it is logged, to be
    // opened once by whoever sets the filter up.
    const link = /https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s"<>]+/.exec(
      `${mail.text ?? ""} ${mail.html ?? ""}`,
    );
    console.log("inbox: gmail forwarding confirmation", mail.subject, link?.[0] ?? "no link");
    return;
  }
  // Cloudflare rejects mail that fails the From domain's DMARC policy (the banks publish
  // p=reject), but that covers the From header, not the envelope sender: both must be allowed.
  const header = mail.from && "address" in mail.from ? (mail.from.address ?? "") : "";
  if (header.trim().toLowerCase() === MEU_PLUGGY && owners.includes(untagged(from))) {
    // Only the link of a sign-in Neko began opens anything (finishSignIn checks its state).
    const link = signInLink(`${mail.text ?? ""} ${mail.html ?? ""}`);
    const done = link
      ? await finishSignIn(env.DB, env, meuPluggy.fetch ?? fetch, link, now).catch((error) => {
          console.error("inbox: meu pluggy sign-in failed", error);
          return false;
        })
      : false;
    console.log("inbox: meu pluggy sign-in", done ? "finished" : "not ours or expired");
    if (done) meuPluggy.signedIn?.();
    return;
  }
  if (!allowedSender(from, owners, billers) || !allowedSender(header, owners, billers)) {
    console.warn("inbox: sender refused", from.replace(/^[^@]+/, "…"));
    message.setReject("Endereço só para faturas do dono do Neko.");
    return;
  }
  const text = `${mail.text ?? ""} ${mail.html ?? ""}`;
  // A biller's bill (light, phone): its value and due day are the whole news, and its PDF is no
  // card statement, so it is never read as one.
  const biller =
    billerOf(header, billers) ??
    (owners.includes(untagged(header)) ? billerOf(forwardedFrom(text), billers) : null);
  if (biller) {
    const conta = mailedConta(text);
    if (!conta) {
      console.warn("inbox: biller e-mail without a bill", biller, mail.subject);
      return;
    }
    await env.DB.prepare(
      "INSERT INTO mailed_conta (biller, due_date, total, read_at) VALUES (?, ?, ?, ?) ON CONFLICT (biller, due_date) DO UPDATE SET total = excluded.total, read_at = excluded.read_at",
    )
      .bind(biller, conta.due, conta.total, now.toISOString())
      .run();
    console.log("inbox: mailed conta", biller, conta.due, conta.total);
    return;
  }
  const bill = mailedBill(text, todayIn(now));
  if (bill) {
    // The total is the whole news: the PDF is not read, and the card has no feed to add lines to.
    await env.DB.prepare(
      "INSERT INTO mailed_bill (card, due_date, total, read_at) VALUES (?, ?, ?, ?) ON CONFLICT (card, due_date) DO UPDATE SET total = excluded.total, read_at = excluded.read_at",
    )
      .bind(bill.card, bill.due, bill.total, now.toISOString())
      .run();
    console.log("inbox: mailed bill", bill.card, bill.due, bill.total);
    return;
  }
  const pdfs = mail.attachments.filter(
    (a) => a.mimeType === "application/pdf" || /\.pdf$/i.test(a.filename ?? ""),
  );
  if (pdfs.length === 0) {
    console.warn("inbox: no pdf", mail.subject);
    return;
  }
  for (const pdf of pdfs) {
    const answer = await take(env, { pdf: String(pdf.content) });
    console.log(
      "inbox: statement",
      answer.read
        ? `due ${answer.due}, ${answer.lines} lines, ${answer.added.length} added`
        : answer.reason,
    );
  }
};
