/** Joining words that stay lowercase inside a name. */
const SMALL_WORDS = new Set("a as o os e de da das do dos em na no para".split(" "));

/**
 * A bank's description as people write it: banks send "PIX FEIRA DO BAIRRO" in capitals, read as
 * "Pix Feira do Bairro". Text that already has lowercase, and words with digits, stay as sent.
 * The web's lists and the notifications both use it.
 */
export const bankText = (text: string) => {
  if (/\p{Ll}/u.test(text)) return text;
  return text
    .split(" ")
    .map((word, i) => {
      if (/\d/.test(word)) return word;
      const lower = word.toLocaleLowerCase("pt-BR");
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toLocaleUpperCase("pt-BR") + lower.slice(1);
    })
    .join(" ");
};
