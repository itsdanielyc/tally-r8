// Finding past transactions: text in the payee or note, a category (or
// uncategorised), a date range and an amount range. The amount range compares
// the size of an amount, whether it is spending or income.
import type { Transaction } from "../contracts/tally";
import { isValidIsoDate } from "./dates";
import { parseTypedAmount } from "./money";

/** The filter as typed: every field a string, empty meaning "any". */
export type Filter = {
  text: string;
  /** "" any category, "none" uncategorised, or a category id. */
  category: string;
  from: string;
  to: string;
  min: string;
  max: string;
};

export const NO_FILTER: Filter = { text: "", category: "", from: "", to: "", min: "", max: "" };

export function isFiltered(f: Filter): boolean {
  return Object.values(f).some((v) => v.trim() !== "");
}

type Bound = { value: number | null; problem: string | null };

function bound(text: string, digits: number, label: string): Bound {
  if (text.trim() === "") return { value: null, problem: null };
  const r = parseTypedAmount(text, digits);
  return r.ok ? { value: r.value, problem: null } : { value: null, problem: `${label}: ${r.reason}` };
}

function dateBound(text: string, label: string): { value: string | null; problem: string | null } {
  const t = text.trim();
  if (t === "") return { value: null, problem: null };
  return isValidIsoDate(t) ? { value: t, problem: null } : { value: null, problem: `${label} must be a real day, as YYYY-MM-DD.` };
}

function matches(t: Transaction, f: Filter, range: { from: string | null; to: string | null; min: number | null; max: number | null }): boolean {
  const text = f.text.trim().toLowerCase();
  if (text && !t.payee.toLowerCase().includes(text) && !t.note.toLowerCase().includes(text)) return false;
  if (f.category === "none" ? t.categoryId !== null : f.category !== "" && t.categoryId !== f.category) return false;
  if ((range.from && t.date < range.from) || (range.to && t.date > range.to)) return false;
  const size = Math.abs(t.amount);
  return !((range.min !== null && size < range.min) || (range.max !== null && size > range.max));
}

/** The transactions the filter keeps, in the order given, and what in it could not be read. */
export function applyFilter(transactions: Transaction[], f: Filter, digits: number): { shown: Transaction[]; problems: string[] } {
  const from = dateBound(f.from, "From");
  const to = dateBound(f.to, "To");
  const min = bound(f.min, digits, "Smallest amount");
  const max = bound(f.max, digits, "Largest amount");
  const problems = [from, to, min, max].map((b) => b.problem).filter((p): p is string => p !== null);
  const range = { from: from.value, to: to.value, min: min.value, max: max.value };
  return { shown: transactions.filter((t) => matches(t, f, range)), problems };
}
