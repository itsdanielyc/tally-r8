// The one importer. Turns a bank's CSV and a mapping into the transactions to
// add, the rows that could not be read (with line and reason), and the count
// of rows already in the ledger. The preview and the import both call
// planImport, so what the person sees is what gets imported.
import type { ImportMapping, Result, TransactionInput } from "../contracts/tally";
import { DELIMITERS, parseCsv, type CsvRecord } from "./csv-parse";
import { matchRule } from "./categories";
import { parseBankDate } from "./dates";
import type { Ledger } from "./ledger";
import { currencyDigits, parseAmount } from "./money";
import { cleanText, PAYEE_MAX, validateInput } from "./transactions";

const MAX_IMPORT_CHARS = 10 * 1024 * 1024;

type ImportRow = TransactionInput & { line: number };
type Rejected = { line: number; reason: string };
export type ImportPlan = { rows: ImportRow[]; duplicates: number; rejected: Rejected[] };

type LedgerView = Pick<Ledger, "transactions" | "settings" | "categories" | "rules">;

function invalid(message: string): { ok: false; error: { code: "invalid"; message: string; field: "mapping" } } {
  return { ok: false, error: { code: "invalid", message, field: "mapping" } };
}

const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1000;

function checkAmount(v: unknown): ImportMapping["amount"] | null {
  if (typeof v !== "object" || v === null) return null;
  const a = v as Record<string, unknown>;
  if (a.kind === "signed" && isIndex(a.column)) return { kind: "signed", column: a.column };
  if (a.kind === "split" && isIndex(a.debit) && isIndex(a.credit) && a.debit !== a.credit) {
    return { kind: "split", debit: a.debit, credit: a.credit };
  }
  return null;
}

/** A mapping from the renderer, checked field by field. */
export function checkMapping(value: unknown): Result<ImportMapping> {
  if (typeof value !== "object" || value === null) return invalid("The column mapping is missing.");
  const m = value as Record<string, unknown>;
  const delimiter = DELIMITERS.find((d) => d === m.delimiter);
  if (!delimiter) return invalid("The delimiter must be a comma, semicolon, tab or pipe.");
  if (m.headerRow !== null && !isIndex(m.headerRow)) return invalid("The header row is not a row of the file.");
  if (!isIndex(m.date) || !isIndex(m.payee)) return invalid("Choose a column for the date and for the payee.");
  const amount = checkAmount(m.amount);
  if (!amount) return invalid("Choose an amount column, or two different debit and credit columns.");
  if (m.dateOrder !== "YMD" && m.dateOrder !== "DMY" && m.dateOrder !== "MDY") return invalid("Choose a date order.");
  if (m.decimal !== "." && m.decimal !== ",") return invalid("Choose a decimal separator.");
  return { ok: true, value: { delimiter, headerRow: m.headerRow, date: m.date, payee: m.payee, amount, dateOrder: m.dateOrder, decimal: m.decimal } };
}

const ORDER_NAMES = { YMD: "year-month-day", DMY: "day-month-year", MDY: "month-day-year" } as const;

function readAmount(cells: string[], m: ImportMapping, digits: number): { value: number } | { reason: string } {
  if (m.amount.kind === "signed") {
    const r = parseAmount(cells[m.amount.column], digits, m.decimal);
    if (!r.ok) return { reason: r.reason };
    return r.value === 0 ? { reason: "amount is zero" } : { value: r.value };
  }
  const read = (cell: string) => (cell.trim() === "" ? { ok: true as const, value: 0 } : parseAmount(cell, digits, m.decimal));
  const debit = read(cells[m.amount.debit]);
  const credit = read(cells[m.amount.credit]);
  if (!debit.ok) return { reason: `debit ${debit.reason}` };
  if (!credit.ok) return { reason: `credit ${credit.reason}` };
  if (debit.value !== 0 && credit.value !== 0) return { reason: "row has both a debit and a credit amount" };
  if (debit.value === 0 && credit.value === 0) return { reason: "row has no debit or credit amount" };
  return { value: debit.value !== 0 ? -Math.abs(debit.value) : Math.abs(credit.value) };
}

function readRow(r: CsvRecord, m: ImportMapping, ledger: LedgerView, needed: number): ImportRow | Rejected {
  if (r.cells.length < needed) return { line: r.line, reason: `has ${r.cells.length} fields; the mapping needs ${needed}` };
  const rawDate = r.cells[m.date].trim();
  const date = parseBankDate(rawDate, m.dateOrder);
  if (!date) return { line: r.line, reason: `date "${rawDate}" is not a ${ORDER_NAMES[m.dateOrder]} date` };
  const payee = cleanText(r.cells[m.payee]).slice(0, PAYEE_MAX);
  if (payee === "") return { line: r.line, reason: "payee is empty" };
  const amount = readAmount(r.cells, m, currencyDigits(ledger.settings.currency));
  if ("reason" in amount) return { line: r.line, reason: amount.reason };
  const input: TransactionInput = { date, payee, amount: amount.value, categoryId: matchRule(ledger.rules, payee), note: "" };
  const checked = validateInput(input, ledger);
  if (!checked.ok) return { line: r.line, reason: checked.error.message };
  return { ...checked.value, line: r.line };
}

const key = (t: { date: string; amount: number; payee: string }) => `${t.date}|${t.amount}|${t.payee}`;

/**
 * Plans an import. A row identical in date, amount and payee to a transaction
 * already in the ledger is skipped; each existing transaction absorbs at most
 * one row, so a file's own repeated rows import the first time and are all
 * skipped the second time.
 */
export function planImport(text: string, mapping: ImportMapping, ledger: LedgerView): Result<ImportPlan> {
  if (text.length > MAX_IMPORT_CHARS) return invalid("The file is larger than 10 MB.");
  const records = parseCsv(text, mapping.delimiter);
  if (mapping.headerRow !== null && mapping.headerRow >= records.length) return invalid("The header row is not a row of the file.");
  const data = records.slice(mapping.headerRow === null ? 0 : mapping.headerRow + 1);
  const amountColumns = mapping.amount.kind === "signed" ? [mapping.amount.column] : [mapping.amount.debit, mapping.amount.credit];
  const needed = Math.max(mapping.date, mapping.payee, ...amountColumns) + 1;
  const existing = new Map<string, number>();
  for (const t of ledger.transactions) existing.set(key(t), (existing.get(key(t)) ?? 0) + 1);
  const plan: ImportPlan = { rows: [], duplicates: 0, rejected: [] };
  for (const record of data) {
    const row = readRow(record, mapping, ledger, needed);
    if ("reason" in row) {
      plan.rejected.push(row);
      continue;
    }
    const left = existing.get(key(row)) ?? 0;
    if (left > 0) {
      existing.set(key(row), left - 1);
      plan.duplicates++;
    } else {
      plan.rows.push(row);
    }
  }
  return { ok: true, value: plan };
}

/** Adds every planned row, in file order, with fresh ids. */
export function applyImport(ledger: Ledger, plan: ImportPlan): Ledger {
  const added = plan.rows.map((r, i) => ({ id: `t${ledger.nextId + i}`, date: r.date, payee: r.payee, amount: r.amount, categoryId: r.categoryId, note: r.note }));
  return { ...ledger, transactions: [...ledger.transactions, ...added], nextId: ledger.nextId + added.length };
}
