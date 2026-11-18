// Reading CSV text into records, the way spreadsheets and banks write it
// (RFC 4180 and its common variations): fields may be quoted, a quoted field
// may hold the delimiter, doubled quotes and line breaks; lines may end in
// CRLF, LF or CR. Each record keeps the file line it starts on, so a row that
// cannot be imported can be named by the line a text editor shows. A quote
// that never closes spoils only its own record: it is marked broken and
// reading goes on from the next line.
import type { Delimiter } from "../contracts/tally";

export type CsvRecord = { line: number; cells: string[]; broken?: true };

export const DELIMITERS: readonly Delimiter[] = [",", ";", "\t", "|"];

type Cursor = { text: string; i: number; line: number; open: boolean };

/** Spaces between a delimiter and an opening quote are not part of the field: skip them. */
function skipToQuote(c: Cursor, delimiter: string): void {
  let start = c.i;
  while (c.text[start] === " " || (c.text[start] === "\t" && delimiter !== "\t")) start++;
  if (c.text[start] === '"') c.i = start;
}

/** Reads one field starting at the cursor; leaves the cursor on the character after it. */
function readField(c: Cursor, delimiter: string): string {
  skipToQuote(c, delimiter);
  if (c.text[c.i] !== '"') {
    let end = c.i;
    while (end < c.text.length && c.text[end] !== delimiter && c.text[end] !== "\n" && c.text[end] !== "\r") end++;
    const value = c.text.slice(c.i, end);
    c.i = end;
    return value;
  }
  let value = "";
  c.i++; // the opening quote
  while (c.i < c.text.length) {
    const ch = c.text[c.i];
    if (ch === '"') {
      if (c.text[c.i + 1] === '"') {
        value += '"';
        c.i += 2;
        continue;
      }
      c.i++; // the closing quote; anything up to the delimiter is kept as written
      return value + readField(c, delimiter);
    }
    if (ch === "\n" || (ch === "\r" && c.text[c.i + 1] !== "\n")) c.line++;
    value += ch;
    c.i++;
  }
  c.open = true; // the quote never closed
  return value;
}

/** Moves the cursor to the start of the line after the one `from` is on. */
function nextLine(c: Cursor, from: number, line: number): void {
  const ending = /\r\n|\n|\r/g;
  ending.lastIndex = from;
  const found = ending.exec(c.text);
  c.i = found ? found.index + found[0].length : c.text.length;
  c.line = line + 1;
  c.open = false;
}

/** Consumes one line ending if the cursor is on one. */
function endOfLine(c: Cursor): boolean {
  if (c.text[c.i] === "\r") {
    c.i += c.text[c.i + 1] === "\n" ? 2 : 1;
  } else if (c.text[c.i] === "\n") {
    c.i++;
  } else {
    return false;
  }
  c.line++;
  return true;
}

/** Every non-blank record of the text, with the line it starts on (1-based). */
export function parseCsv(text: string, delimiter: Delimiter, limit = Infinity): CsvRecord[] {
  const records: CsvRecord[] = [];
  const c: Cursor = { text: text.replace(/^\uFEFF/, ""), i: 0, line: 1, open: false };
  while (c.i < c.text.length && records.length < limit) {
    const line = c.line;
    const start = c.i;
    const cells = [readField(c, delimiter)];
    while (!c.open && c.text[c.i] === delimiter) {
      c.i++;
      cells.push(readField(c, delimiter));
    }
    if (c.open) {
      records.push({ line, cells: [], broken: true });
      nextLine(c, start, line);
      continue;
    }
    endOfLine(c);
    if (cells.length > 1 || cells[0].trim() !== "") records.push({ line, cells });
  }
  return records;
}

/** The most common field count among records, preferring the larger on a tie. */
export function modalWidth(records: CsvRecord[]): number {
  const counts = new Map<number, number>();
  for (const r of records) counts.set(r.cells.length, (counts.get(r.cells.length) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [width, count] of counts) {
    if (count > bestCount || (count === bestCount && width > best)) [best, bestCount] = [width, count];
  }
  return best;
}

/**
 * The delimiter that splits the first records most consistently into more
 * than one field: the most records sharing one width, then the wider split.
 */
export function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const records = parseCsv(text, d, 50);
    const width = modalWidth(records);
    if (width < 2) continue;
    const share = records.filter((r) => r.cells.length === width).length / records.length;
    const score = share * 1000 + width;
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}
