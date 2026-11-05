import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { unlockPdf } from "../src/worker/pdf.ts";

// An invented one-page bill, saved plain and locked the way banks lock theirs.
const bill = async (lock?: { password: string; algorithm: "AES-128" | "RC4-128" }) => {
  const doc = await PDFDocument.create();
  doc.addPage().drawText("FATURA INVENTADA  Total R$ 123,45");
  if (lock)
    doc.encrypt({
      userPassword: lock.password,
      ownerPassword: "dono-do-banco",
      algorithm: lock.algorithm,
      allowWeakCryptography: true,
    });
  return Buffer.from(await doc.save()).toString("base64");
};

// The drawn text, as the page's content stream writes it (hex, standard font).
const TEXT = Buffer.from("FATURA INVENTADA").toString("hex").toUpperCase();

const opened = async (pdf: string) => {
  const doc = await PDFDocument.load(Buffer.from(pdf, "base64"), { ignoreEncryption: true });
  const contents = doc.getPage(0).node.Contents();
  const stream = contents instanceof PDFArray ? doc.context.lookup(contents.get(0)) : contents;
  let text = false;
  try {
    // A locked stream does not even inflate.
    text =
      stream instanceof PDFRawStream &&
      Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1").includes(TEXT);
  } catch {}
  return { encrypted: doc.isEncrypted, pages: doc.getPageCount(), text };
};

describe("a bill PDF locked with a password", () => {
  it("passes a plain PDF through as it is", async () => {
    const plain = await bill();
    expect(await opened(plain)).toMatchObject({ encrypted: false, text: true });
    expect(await unlockPdf(plain, [])).toBe(plain);
  });

  it("opens with the first password that fits, for the ciphers banks use", async () => {
    for (const algorithm of ["AES-128", "RC4-128"] as const) {
      const locked = await bill({ password: "123456", algorithm });
      expect(await opened(locked)).toMatchObject({ encrypted: true, text: false });
      const open = await unlockPdf(locked, ["999999", "123456"]);
      expect(open && (await opened(open))).toEqual({ encrypted: false, pages: 1, text: true });
    }
  });

  it("gives up when no password fits, or the file is no PDF", async () => {
    const locked = await bill({ password: "123456", algorithm: "AES-128" });
    expect(await unlockPdf(locked, ["999999"])).toBeNull();
    expect(await unlockPdf(locked, [])).toBeNull();
    expect(await unlockPdf(btoa("não é um pdf"), ["123456"])).toBeNull();
  });
});
