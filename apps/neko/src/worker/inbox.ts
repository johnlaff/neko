import {
  type Cents,
  cents,
  clampedDay,
  diffDays,
  type LocalDate,
  parts,
  todayIn,
} from "@neko/engine";
import PostalMime from "postal-mime";
import type { StatementAnswer } from "../shared/types.ts";
import type { Env } from "./env.ts";
import { takeStatement } from "./statement.ts";

/**
 * fatura@ on the Neko domain (Cloudflare Email Routing sends it to this Worker): the bank's bill
 * PDF, straight from the bank or forwarded by the owner's mail filter, read like one sent from
 * Faturas. Anyone else's mail is refused; nothing here reaches the sheet.
 */

/** The banks whose bills are taken as they arrive. */
const BANKS = /@(?:[a-z0-9-]+\.)*(?:bradesco|infobradesco|bradescard|nubank)\.com\.br$/i;

/** Gmail's sender for the code that confirms a forwarding address. */
const GMAIL_FORWARDING = "forwarding-noreply@google.com";

/** A Gmail filter forwards with the owner's address tagged, as in dono+caf_=fatura=…@gmail.com. */
const untagged = (address: string) => address.replace(/\+[^@]*@/, "@");

export const allowedSender = (from: string, owners: readonly string[]): boolean => {
  const address = from.trim().toLowerCase();
  return owners.includes(untagged(address)) || BANKS.test(address);
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
): Promise<void> => {
  const from = message.from.trim().toLowerCase();
  const owners = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
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
  if (!allowedSender(from, owners) || !allowedSender(header, owners)) {
    console.warn("inbox: sender refused", from.replace(/^[^@]+/, "…"));
    message.setReject("Endereço só para faturas do dono do Neko.");
    return;
  }
  const bill = mailedBill(`${mail.text ?? ""} ${mail.html ?? ""}`, todayIn(now));
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
