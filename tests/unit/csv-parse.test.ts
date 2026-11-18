// L1: reading CSV text (quotes, delimiters, line endings, line numbers) and
// the first look at a bank file (delimiter, header row, column guesses).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectCsv } from "../../core/csv-inspect";
import { detectDelimiter, parseCsv } from "../../core/csv-parse";
import { parseBankDate } from "../../core/dates";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", "csv", name), "utf8");

describe("parseCsv", () => {
  it("reads quoted fields holding the delimiter, doubled quotes and line breaks", () => {
    const text = 'a,"b, c","say ""hi"""\n"multi\nline",x,""\n';
    expect(parseCsv(text, ",")).toEqual([
      { line: 1, cells: ["a", "b, c", 'say "hi"'] },
      { line: 2, cells: ["multi\nline", "x", ""] },
    ]);
  });

  it("numbers records by the file line they start on, across CRLF, CR and quoted breaks", () => {
    const text = 'h1;h2\r\n"one\r\ntwo";x\r\n\r\nthree;y\rfour;z';
    expect(parseCsv(text, ";").map((r) => [r.line, r.cells[0]])).toEqual([[1, "h1"], [2, "one\r\ntwo"], [5, "three"], [6, "four"]]);
  });

  it("skips blank lines, drops a byte order mark, and keeps an unterminated quote to the end", () => {
    expect(parseCsv("\uFEFFa,b\n\n   \nc,d", ",").map((r) => r.cells)).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv('a,"open\nstill', ",")[0].cells).toEqual(["a", "open\nstill"]);
  });

  it("keeps empty fields, including trailing ones", () => {
    expect(parseCsv("a,,c,\n", ",")[0].cells).toEqual(["a", "", "c", ""]);
  });
});

describe("detectDelimiter", () => {
  it("finds comma, semicolon, tab and pipe", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1,5;2,5;3")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter("a|b|c\n1|2|3")).toBe("|");
  });

  it("is not fooled by commas inside quoted fields or by decimal commas", () => {
    expect(detectDelimiter('Date;Payee;Amount\n01.10.2026;"Smith, J";-12,50\n02.10.2026;Shop;-1,00')).toBe(";");
  });
});

describe("parseBankDate", () => {
  it("reads each date order, with any common separator and two- or four-digit years", () => {
    expect(parseBankDate("31.12.2026", "DMY")).toBe("2026-12-31");
    expect(parseBankDate("12/31/2026", "MDY")).toBe("2026-12-31");
    expect(parseBankDate("2026-12-31", "DMY")).toBe("2026-12-31");
    expect(parseBankDate("26/12/31", "YMD")).toBe("2026-12-31");
    expect(parseBankDate("1-2-26", "DMY")).toBe("2026-02-01");
    expect(parseBankDate("2026-12-31T08:30:00Z", "MDY")).toBe("2026-12-31");
  });

  it("refuses days that do not exist in the chosen order", () => {
    expect(parseBankDate("12/31/2026", "DMY")).toBeNull();
    expect(parseBankDate("29.02.2026", "DMY")).toBeNull();
    expect(parseBankDate("yesterday", "DMY")).toBeNull();
    expect(parseBankDate("1.2.123", "DMY")).toBeNull();
  });
});

describe("inspectCsv", () => {
  it("guesses a comma file with a header and one signed amount column", () => {
    const i = inspectCsv(fixture("bank-comma.csv"));
    expect(i.delimiter).toBe(",");
    expect(i.headerRow).toBe(0);
    expect(i.columns).toEqual(["Date", "Description", "Amount", "Balance"]);
    expect(i.mapping).toEqual({ delimiter: ",", headerRow: 0, date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "YMD", decimal: ".", category: null, note: null });
  });

  it("skips a preamble, finds the header, and guesses debit and credit with decimal commas", () => {
    const i = inspectCsv(fixture("bank-semicolon.csv"));
    expect(i.delimiter).toBe(";");
    expect(i.headerRow).toBe(2);
    expect(i.records[2].line).toBe(4);
    expect(i.mapping).toEqual({ delimiter: ";", headerRow: 2, date: 0, payee: 1, amount: { kind: "split", debit: 2, credit: 3 }, dateOrder: "DMY", decimal: ",", category: null, note: 4 });
  });

  it("without a header, names columns by number and guesses from the contents", () => {
    const i = inspectCsv("12/31/2026,Shop,-4.50\n01/02/2027,Bakery,-2.00\n");
    expect(i.headerRow).toBeNull();
    expect(i.columns).toEqual(["Column 1", "Column 2", "Column 3"]);
    expect(i.mapping).toMatchObject({ date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "MDY", decimal: "." });
  });

  it("re-reads with a delimiter the person chose", () => {
    expect(inspectCsv("a;b,c\n1;2,3", ",").columns).toEqual(["a;b", "c"]);
  });
});
