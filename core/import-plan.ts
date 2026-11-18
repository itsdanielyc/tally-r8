// The one importer. Turns a bank's CSV and a mapping into the transactions to
// add, the rows that could not be read (with line and reason), and the count
// of rows already in the ledger. The preview and the import both call
// planImport, so what the person sees is what gets imported.
import type { Category, ImportMapping, Result, TransactionInput } from "../contracts/tally";
import { DELIMITERS, parseCsv, type CsvRecord } from "./csv-parse";
import { CATEGORY_NAME_MAX, matchRule } from "./categories";
import { parseBankDate } from "./dates";
import type { Ledger } from "./ledger";
import { currencyDigits, parseAmount } from "./money";
import { cleanText, PAYEE_MAX, validateInput } from "./transactions";

const MAX_IMPORT_CHARS = 10 * 1024 * 1024;

/** A row to add. `newCategory`: a category name from the file that the ledger does not have yet. */
type ImportRow = TransactionInput & { line: number; newCategory: string | null };
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

/** An optional column: null when absent, the index when valid, undefined when malformed. */
const optional = (v: unknown): number | null | undefined => (v === undefined || v === null ? null : isIndex(v) ? v : undefined);

/** The date order and decimal separator: the problem with them, or null. */
function formatProblem(m: Record<string, unknown>): string | null {
  if (m.dateOrder !== "YMD" && m.dateOrder !== "DMY" && m.dateOrder !== "MDY") return "Choose a date order.";
  if (m.decimal !== "." && m.decimal !== ",") return "Choose a decimal separator.";
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
  const problem = formatProblem(m);
  if (problem) return invalid(problem);
  const category = optional(m.category);
  const note = optional(m.note);
  if (category === undefined || note === undefined) return invalid("The category and note columns must be columns of the file, or none.");
  const { dateOrder, decimal } = m as Pick<ImportMapping, "dateOrder" | "decimal">;
  return { ok: true, value: { delimiter, headerRow: m.headerRow, date: m.date, payee: m.payee, amount, dateOrder, decimal, category, note } };
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

/**
 * The category a row gets: the file's own category column when it has a name
 * (an existing category matched ignoring case, or a new one), otherwise the
 * first matching rule.
 */
function readCategory(cells: string[], m: ImportMapping, ledger: LedgerView, payee: string): { categoryId: string | null; newCategory: string | null } {
  const named = m.category === null || m.category === undefined ? "" : cleanText(cells[m.category] ?? "").slice(0, CATEGORY_NAME_MAX);
  if (named === "") return { categoryId: matchRule(ledger.rules, payee), newCategory: null };
  const existing = ledger.categories.find((c) => c.name.toLowerCase() === named.toLowerCase());
  return existing ? { categoryId: existing.id, newCategory: null } : { categoryId: null, newCategory: named };
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
  const { categoryId, newCategory } = readCategory(r.cells, m, ledger, payee);
  const note = m.note === null || m.note === undefined ? "" : (r.cells[m.note] ?? "");
  const input: TransactionInput = { date, payee, amount: amount.value, categoryId, note };
  const checked = validateInput(input, ledger);
  if (!checked.ok) return { line: r.line, reason: checked.error.message };
  return { ...checked.value, line: r.line, newCategory };
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
  const optionalColumns = [mapping.category ?? -1, mapping.note ?? -1];
  const needed = Math.max(mapping.date, mapping.payee, ...amountColumns, ...optionalColumns) + 1;
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

/**
 * Adds every planned row, in file order, with fresh ids, creating the
 * categories the file names that the ledger does not have. A plan with no
 * rows returns the ledger itself: nothing changed.
 */
export function applyImport(ledger: Ledger, plan: ImportPlan): Ledger {
  if (plan.rows.length === 0) return ledger;
  let nextId = ledger.nextId;
  const created: Category[] = [];
  const idFor = (name: string): string => {
    const found = created.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const category: Category = { id: `c${nextId++}`, name, budget: null };
    created.push(category);
    return category.id;
  };
  const added = plan.rows.map((r) => {
    const categoryId = r.newCategory === null ? r.categoryId : idFor(r.newCategory);
    return { id: `t${nextId++}`, date: r.date, payee: r.payee, amount: r.amount, categoryId, note: r.note };
  });
  return { ...ledger, categories: [...ledger.categories, ...created], transactions: [...ledger.transactions, ...added], nextId };
}
