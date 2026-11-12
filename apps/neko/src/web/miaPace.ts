/**
 * Mia's words at reading pace (the app's Mia2Pace): what arrives in bursts shows as a steady flow,
 * word by word, each word fading in. Never slower than PACE_MIN, never more than about PACE_LAG
 * behind what arrived, so a fast answer is not held back. As in the AI SDK's smoothStream,
 * OpenHands and LibreChat; the fade is Streamdown's default kind (opacity only, ease-out).
 */

/** Characters per second when little is waiting. */
export const PACE_MIN = 90;
/** Seconds: how far behind what arrived the words may run. */
export const PACE_LAG = 0.4;
/** How long a new word takes to fade in. */
export const WORD_FADE_MS = 250;

/** Where the reveal is after `dt` seconds, from `pos`, with `length` characters arrived. */
export const paceStep = (pos: number, length: number, dt: number): number =>
  Math.min(length, pos + Math.max(PACE_MIN, (length - pos) / PACE_LAG) * dt);

const space = /\s/;

/** A word that never shows alone: "R$" without its amount, or a list's mark without its item. */
const glued = (head: string) => head.endsWith("R$") || /(?:^|\n)[ \t]*(?:[-*]|\d+\.)$/.test(head);

/**
 * How much of `text` shows with the reveal at `pos`: whole words only, "R$" with its amount, a
 * list's mark with its item, and the last word only once the text is `done` (it may still grow).
 */
export const paceCut = (text: string, pos: number, done: boolean): number => {
  let at = Math.min(text.length, Math.ceil(pos));
  if (at === 0) return 0;
  // The word the reveal is in shows whole, up to the space after it.
  while (at < text.length) {
    while (at < text.length && !space.test(text.charAt(at))) at++;
    if (at < text.length && glued(text.slice(0, at))) {
      at++;
      continue;
    }
    break;
  }
  if (at < text.length || done) return at;
  // The last word may still be coming: it waits for the space after it, and so does an "R$" or a
  // list's mark that goes with it.
  let end = before(text, text.length);
  if (glued(text.slice(0, end))) end = before(text, end);
  return end;
};

/** Where the last whole word before `end` ends: a word cut at `end` does not count. */
const before = (text: string, end: number): number => {
  let at = end;
  while (at > 0 && !space.test(text.charAt(at - 1))) at--;
  while (at > 0 && space.test(text.charAt(at - 1))) at--;
  return at;
};
