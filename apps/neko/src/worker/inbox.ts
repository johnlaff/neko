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
const BANKS = /@(?:[a-z0-9-]+\.)*(?:bradesco|infobradesco|bradescard)\.com\.br$/i;

/** Gmail's sender for the code that confirms a forwarding address. */
const GMAIL_FORWARDING = "forwarding-noreply@google.com";

/** A Gmail filter forwards with the owner's address tagged, as in dono+caf_=fatura=…@gmail.com. */
const untagged = (address: string) => address.replace(/\+[^@]*@/, "@");

export const allowedSender = (from: string, owners: readonly string[]): boolean => {
  const address = from.trim().toLowerCase();
  return owners.includes(untagged(address)) || BANKS.test(address);
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
  if (!allowedSender(from, owners)) {
    console.warn("inbox: sender refused", from.replace(/^[^@]+/, "…"));
    message.setReject("Endereço só para faturas do dono do Neko.");
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
