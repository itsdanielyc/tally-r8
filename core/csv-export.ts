// The one exporter. Writes transactions as a CSV that Tally's own import reads
// back as the same transactions: ISO dates, signed amounts with a decimal
// point, the category by name, and RFC 4180 quoting for any field that holds a
// comma, a quote or a line break.
import type { Category, Transaction } from "../contracts/tally";
import { currencyDigits, plainAmount } from "./money";

const EXPORT_HEADER = ["Date", "Payee", "Amount", "Category", "Note"] as const;

function field(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The file for the given transactions. They are written oldest first, so a
 * re-import gives same-day transactions the same order they are shown in now.
 */
export function exportCsv(transactions: Transaction[], categories: Category[], currency: string): string {
  const digits = currencyDigits(currency);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const rows = [...transactions].reverse().map((t) =>
    [t.date, t.payee, plainAmount(t.amount, digits), t.categoryId ? (names.get(t.categoryId) ?? "") : "", t.note].map(field).join(","));
  return [EXPORT_HEADER.join(","), ...rows].join("\r\n") + "\r\n";
}
