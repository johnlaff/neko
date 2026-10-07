/** Civil date with no time or zone, as `YYYY-MM-DD`. "Today" always comes in as a parameter. */
export type LocalDate = string & { readonly __brand: "LocalDate" };

export const TIME_ZONE = "America/Sao_Paulo";

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const localDate = (s: string): LocalDate => {
  const m = RE.exec(s);
  if (!m) throw new RangeError(`invalid date: ${s}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo))
    throw new RangeError(`invalid date: ${s}`);
  return s as LocalDate;
};

export const ymd = (year: number, month: number, day: number): LocalDate =>
  localDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);

export const parts = (d: LocalDate) => ({
  year: Number(d.slice(0, 4)),
  month: Number(d.slice(5, 7)),
  day: Number(d.slice(8, 10)),
});

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const toUtc = (d: LocalDate) => {
  const { year, month, day } = parts(d);
  return Date.UTC(year, month - 1, day);
};

const fromUtc = (ms: number): LocalDate => localDate(new Date(ms).toISOString().slice(0, 10));

export const addDays = (d: LocalDate, n: number): LocalDate => fromUtc(toUtc(d) + n * 86_400_000);

/** Whole days from `a` to `b` (positive when `b` is later). */
export const diffDays = (a: LocalDate, b: LocalDate): number =>
  Math.round((toUtc(b) - toUtc(a)) / 86_400_000);

/** Same day number in another month, clamped to that month's length (31 → 30 in April). */
export const clampedDay = (year: number, month: number, day: number): LocalDate => {
  const y = year + Math.floor((month - 1) / 12);
  const m = ((((month - 1) % 12) + 12) % 12) + 1;
  return ymd(y, m, Math.min(day, daysInMonth(y, m)));
};

/** Today's civil date in São Paulo for a given instant. Only the shell calls this. */
export const todayIn = (instant: Date, timeZone = TIME_ZONE): LocalDate =>
  localDate(new Intl.DateTimeFormat("en-CA", { timeZone }).format(instant));
