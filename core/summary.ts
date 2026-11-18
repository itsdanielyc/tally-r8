// A month at a glance: income against spending, the total per category, and
// how each category stands against its monthly budget. Months are the first
// seven characters of a calendar date, so there are no time zones and no
// boundary to get wrong; every figure is a sum of integers.
import type { Category, Transaction } from "../contracts/tally";

type CategoryLine = {
  /** null for uncategorised transactions. */
  id: string | null;
  name: string;
  /** Signed sum of the month's transactions in this category. */
  total: number;
  /** Spending counted against the budget: minus the total, so refunds reduce it. */
  spent: number;
  budget: number | null;
  /** budget - spent; negative means over budget. null when there is no budget. */
  left: number | null;
};

export type MonthSummary = {
  month: string;
  /** The month's transactions, newest first, exactly the ones the totals add up. */
  transactions: Transaction[];
  income: number;
  /** Positive: the sum of the month's negative amounts, sign removed. */
  spending: number;
  net: number;
  lines: CategoryLine[];
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(text: string): boolean {
  return MONTH.test(text);
}

export function addMonths(month: string, delta: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(month: string): string {
  return `${NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

function line(id: string | null, name: string, total: number, budget: number | null): CategoryLine {
  const spent = -total;
  return { id, name, total, spent: spent === 0 ? 0 : spent, budget, left: budget === null ? null : budget - spent };
}

/**
 * The summary of one month. A category appears when it has transactions that
 * month or a budget; uncategorised transactions get their own line, last.
 */
export function monthSummary(month: string, transactions: Transaction[], categories: Category[]): MonthSummary {
  const inMonth = transactions.filter((t) => t.date.startsWith(`${month}-`));
  const known = new Set(categories.map((c) => c.id));
  const totals = new Map<string | null, number>();
  let income = 0;
  let spending = 0;
  for (const t of inMonth) {
    if (t.amount > 0) income += t.amount;
    else spending -= t.amount;
    // A link to a category that no longer exists counts as uncategorised, so the lines always add up to the net.
    const key = t.categoryId !== null && known.has(t.categoryId) ? t.categoryId : null;
    totals.set(key, (totals.get(key) ?? 0) + t.amount);
  }
  const lines = categories
    .filter((c) => totals.has(c.id) || c.budget !== null)
    .map((c) => line(c.id, c.name, totals.get(c.id) ?? 0, c.budget));
  if (totals.has(null)) lines.push(line(null, "Uncategorised", totals.get(null) ?? 0, null));
  return { month, transactions: inMonth, income, spending, net: income - spending, lines };
}
