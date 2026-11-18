// Calendar dates as "YYYY-MM-DD" strings. A transaction happens on a day, not
// at an instant, so there is no time zone anywhere in the ledger and a month
// is simply the first seven characters.
import type { DateOrder } from "../contracts/tally";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Builds "YYYY-MM-DD" when the parts name a real day in years 1000 to 9999. */
function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isValidIsoDate(text: string): boolean {
  const m = ISO.exec(text);
  return m !== null && isoDate(Number(m[1]), Number(m[2]), Number(m[3])) === text;
}

/** The local calendar day of an instant, for the form's default date. */
export function localIsoDate(now: Date): string {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate()) ?? "2000-01-01";
}

const PARTS = /^(\d{1,4})[./\- ](\d{1,2})[./\- ](\d{1,4})(?:[T ].*)?$/;

/**
 * Reads a bank's date ("31/12/2026", "12-31-26", "2026.12.31",
 * "2026-12-31T00:00:00") in the given order. A four-digit first part is always
 * a year, whatever the order. Two-digit years are 2000 to 2099.
 */
export function parseBankDate(text: string, order: DateOrder): string | null {
  const m = PARTS.exec(text.trim());
  if (!m) return null;
  const [, a, b, c] = m;
  if (a.length === 4) return isoDate(Number(a), Number(b), Number(c));
  if (order === "YMD") return a.length === 2 ? isoDate(2000 + Number(a), Number(b), Number(c)) : null;
  const year = c.length === 4 ? Number(c) : c.length === 2 ? 2000 + Number(c) : NaN;
  return order === "DMY" ? isoDate(year, Number(b), Number(a)) : isoDate(year, Number(a), Number(b));
}
