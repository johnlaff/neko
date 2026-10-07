import { type Cents, cents } from "@neko/engine";

/**
 * Parses a pt-BR or en-US money string into cents. With both separators the last one is the
 * decimal mark; a single separator is a decimal unless it is clearly thousands grouping.
 * Returns null when there are no digits at all.
 */
export const parseNumber = (raw: string): Cents | null => {
  let s = raw.trim();
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1] ?? "";
  }
  s = s.replace(/[^\d.,-]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/\d/.test(s) || s.includes("-")) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    normalized = s.split(thou).join("").replace(dec, ".");
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (sep === null) normalized = s;
    else {
      const groups = s.split(sep);
      const grouping =
        groups.length > 1 &&
        /^\d{1,3}$/.test(groups[0] ?? "") &&
        groups.slice(1).every((g) => /^\d{3}$/.test(g));
      // "1.234" is grouping, but "1,234" written by hand in pt-BR is usually a decimal with
      // three places only by accident; we follow v1 and treat both as grouping.
      normalized = grouping ? groups.join("") : groups.length === 2 ? groups.join(".") : "";
    }
  }
  if (normalized === "" || Number.isNaN(Number(normalized))) return null;
  const value = Math.round(Number(normalized) * 100);
  return cents(negative ? -value : value);
};
