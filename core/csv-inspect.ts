// First look at a bank's CSV: which delimiter it uses, which record is the
// header, what to call each column, and a first guess at the mapping. The
// person sees the guess and can change any of it before importing.
import type { DateOrder, Delimiter, ImportMapping } from "../contracts/tally";
import { type CsvRecord, detectDelimiter, modalWidth, parseCsv } from "./csv-parse";
import { parseBankDate } from "./dates";
import { parseAmount } from "./money";

export type CsvInspection = {
  delimiter: Delimiter;
  records: CsvRecord[];
  headerRow: number | null;
  /** A name per column: the header's text, or "Column n". */
  columns: string[];
  mapping: ImportMapping;
};

const isDate = (cell: string) => parseBankDate(cell, "DMY") !== null || parseBankDate(cell, "MDY") !== null;
const isAmount = (cell: string) => parseAmount(cell, 3, ".").ok || parseAmount(cell, 3, ",").ok;

/** The first full-width record is the header when none of its cells reads as a date or an amount. */
function findHeader(records: CsvRecord[], width: number): number | null {
  const first = records.findIndex((r) => r.cells.length === width);
  if (first < 0) return null;
  const cells = records[first].cells.map((c) => c.trim());
  if (cells.every((c) => c === "")) return null;
  return cells.some((c) => c !== "" && (isDate(c) || isAmount(c))) ? null : first;
}

const NAMES = {
  date: /date|datum|fecha|booked|posted/i,
  debit: /debit|withdrawal|paid out|money out|outflow/i,
  credit: /credit|deposit|paid in|money in|inflow/i,
  amount: /amount|betrag|importe|montant|value|sum/i,
  payee: /payee|description|merchant|name|details|narrative|memo|beneficiary|counterparty|reference|text/i,
};

/** Share of a column's cells (among `rows`) that pass a test. */
function share(rows: CsvRecord[], column: number, test: (cell: string) => boolean): number {
  const cells = rows.map((r) => (r.cells[column] ?? "").trim()).filter((c) => c !== "");
  return cells.length === 0 ? 0 : cells.filter(test).length / cells.length;
}

function guessDateOrder(rows: CsvRecord[], column: number): DateOrder {
  let dmy = false;
  let mdy = false;
  for (const r of rows.slice(0, 200)) {
    const m = /^(\d{1,4})[./\- ](\d{1,2})[./\- ](\d{1,4})/.exec((r.cells[column] ?? "").trim());
    if (!m) continue;
    if (m[1].length === 4) return "YMD";
    if (Number(m[1]) > 12) dmy = true;
    if (Number(m[2]) > 12) mdy = true;
  }
  return mdy && !dmy ? "MDY" : "DMY";
}

function guessDecimal(rows: CsvRecord[], columns: number[]): "." | "," {
  let comma = 0;
  let point = 0;
  for (const r of rows.slice(0, 200)) {
    for (const col of columns) {
      const cell = (r.cells[col] ?? "").trim();
      if (/,\d{1,2}$/.test(cell)) comma++;
      else if (/\.\d{1,2}$/.test(cell)) point++;
    }
  }
  return comma > point ? "," : ".";
}

type Guess = { names: string[]; rows: CsvRecord[]; used: Set<number>; header: boolean };

function pick(g: Guess, pattern: RegExp): number {
  const i = g.header ? g.names.findIndex((n, idx) => !g.used.has(idx) && pattern.test(n)) : -1;
  if (i >= 0) g.used.add(i);
  return i;
}

function pickByContent(g: Guess, test: (cell: string) => boolean): number {
  for (let col = 0; col < g.names.length; col++) {
    if (!g.used.has(col) && share(g.rows, col, test) >= 0.6) {
      g.used.add(col);
      return col;
    }
  }
  return -1;
}

function firstFree(g: Guess): number {
  const col = g.names.findIndex((_, idx) => !g.used.has(idx));
  if (col < 0) return 0;
  g.used.add(col);
  return col;
}

function guessColumn(g: Guess, pattern: RegExp, test: (cell: string) => boolean): number {
  const byName = pick(g, pattern);
  return byName >= 0 ? byName : pickByContent(g, test);
}

function guessAmount(g: Guess): ImportMapping["amount"] {
  const debit = pick(g, NAMES.debit);
  const credit = debit >= 0 ? pick(g, NAMES.credit) : -1;
  if (debit >= 0 && credit >= 0) return { kind: "split", debit, credit };
  if (debit >= 0) g.used.delete(debit);
  const column = guessColumn(g, NAMES.amount, isAmount);
  return { kind: "signed", column: column >= 0 ? column : firstFree(g) };
}

function guessMapping(delimiter: Delimiter, headerRow: number | null, names: string[], rows: CsvRecord[]): ImportMapping {
  const g: Guess = { names, rows, used: new Set<number>(), header: headerRow !== null };
  const foundDate = guessColumn(g, NAMES.date, isDate);
  const amount = guessAmount(g);
  const foundPayee = guessColumn(g, NAMES.payee, (cell) => !isAmount(cell) && !isDate(cell));
  const date = foundDate >= 0 ? foundDate : firstFree(g);
  const payee = foundPayee >= 0 ? foundPayee : firstFree(g);
  return {
    delimiter,
    headerRow,
    date,
    payee,
    amount,
    dateOrder: guessDateOrder(rows, date),
    decimal: guessDecimal(rows, amount.kind === "split" ? [amount.debit, amount.credit] : [amount.column]),
  };
}

/** Reads the text with the given (or detected) delimiter and guesses the rest. */
export function inspectCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): CsvInspection {
  const records = parseCsv(text, delimiter);
  const width = Math.max(1, modalWidth(records));
  const headerRow = findHeader(records, width);
  const header = headerRow === null ? [] : records[headerRow].cells;
  const columns = Array.from({ length: width }, (_, i) => header[i]?.trim() || `Column ${i + 1}`);
  const rows = records.slice(headerRow === null ? 0 : headerRow + 1).filter((r) => r.cells.length === width);
  return { delimiter, records, headerRow, columns, mapping: guessMapping(delimiter, headerRow, columns, rows) };
}
