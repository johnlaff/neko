/** 0-based column index → letters (0 → A, 54 → BC). */
export const columnLetters = (index: number): string => {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

/** 0-based row and column → A1 address. */
export const a1 = (row: number, col: number): string => `${columnLetters(col)}${row + 1}`;
