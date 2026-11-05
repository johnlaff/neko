import { PDFDocument } from "@cantoo/pdf-lib";

/**
 * Banks e-mail the bill as a PDF locked with a password made from the owner's data, and Claude
 * only reads open PDFs. The passwords live in a Worker secret, never in the repository.
 */

/** pdf-lib takes the base64 text as it comes. */
const load = (pdf: string, password?: string) =>
  password === undefined
    ? PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false })
    : PDFDocument.load(pdf, { password, updateMetadata: false });

/** The PDF (base64) as it is when open, opened with the first password that fits, else null. */
export const unlockPdf = async (
  pdf: string,
  passwords: readonly string[],
): Promise<string | null> => {
  try {
    if (!(await load(pdf)).isEncrypted) return pdf;
  } catch {
    return null;
  }
  for (const password of passwords) {
    try {
      const locked = await load(pdf, password);
      // Saving the opened file keeps its old cross-reference stream, which still points at the
      // lock; copying the pages into a new file carries only what the pages use.
      const open = await PDFDocument.create({ updateMetadata: false });
      for (const page of await open.copyPages(locked, locked.getPageIndices())) open.addPage(page);
      return await open.saveAsBase64();
    } catch {
      // Not this password.
    }
  }
  return null;
};
