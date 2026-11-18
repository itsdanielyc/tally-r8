// L1: the importer. Mapping columns to transactions, rows that cannot be read
// (line and reason), duplicates skipped and counted, all or none.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ImportMapping, Result } from "../../contracts/tally";
import { checkMapping, planImport, type ImportPlan } from "../../core/import-plan";
import { emptyLedger, type Ledger } from "../../core/ledger";
import { type LedgerStore, TallyService } from "../../core/service";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "..", "fixtures", "csv", name), "utf8");

const COMMA: ImportMapping = { delimiter: ",", headerRow: 0, date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "YMD", decimal: "." };
const SEMI: ImportMapping = { delimiter: ";", headerRow: 2, date: 0, payee: 1, amount: { kind: "split", debit: 2, credit: 3 }, dateOrder: "DMY", decimal: "," };

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}

const brief = (p: ImportPlan) => p.rows.map((r) => [r.line, r.date, r.payee, r.amount]);

describe("planImport", () => {
  it("maps a signed amount column, keeping quoted payees whole", () => {
    const p = ok(planImport(fixture("bank-comma.csv"), COMMA, emptyLedger()));
    expect(brief(p)).toEqual([
      [2, "2026-10-01", "Employer, Inc. payroll", 320000],
      [3, "2026-10-02", "Corner shop", -1250],
      [4, "2026-10-03", 'Rent "October"', -110000],
      [5, "2026-10-03", "Corner shop", -1250],
      [6, "2026-10-03", "Corner shop", -1250],
      [7, "2026-10-05", "Bakery", -480],
    ]);
    expect(p.rejected).toEqual([
      { line: 8, reason: 'date "not a date" is not a year-month-day date' },
      { line: 9, reason: 'amount "abc" is not a number' },
    ]);
  });

  it("maps debit and credit columns with decimal commas and names the rows it cannot read", () => {
    const p = ok(planImport(fixture("bank-semicolon.csv"), SEMI, emptyLedger()));
    expect(brief(p)).toEqual([
      [5, "2026-10-01", "Employer GmbH", 320000],
      [6, "2026-10-02", "Bakery; Miller", -480],
      [7, "2026-10-03", "City power", -6420],
      [8, "2026-10-04", "Refund shop", 1200],
    ]);
    expect(p.rejected).toEqual([
      { line: 9, reason: "row has both a debit and a credit amount" },
      { line: 10, reason: "row has no debit or credit amount" },
    ]);
  });

  it("reads the date order the person picked", () => {
    const text = "d,p,a\n03/04/2026,Shop,-1.00";
    expect(ok(planImport(text, { ...COMMA, dateOrder: "DMY" }, emptyLedger())).rows[0].date).toBe("2026-04-03");
    expect(ok(planImport(text, { ...COMMA, dateOrder: "MDY" }, emptyLedger())).rows[0].date).toBe("2026-03-04");
  });

  it("rejects short rows, empty payees and zero amounts, and cuts very long payees", () => {
    const text = `d,p,a\n2026-01-01,Shop\n2026-01-02,  ,-1.00\n2026-01-03,Zero,0.00\n2026-01-04,${"x".repeat(250)},-2.00`;
    const p = ok(planImport(text, COMMA, emptyLedger()));
    expect(p.rejected).toEqual([
      { line: 2, reason: "has 2 fields; the mapping needs 3" },
      { line: 3, reason: "payee is empty" },
      { line: 4, reason: "amount is zero" },
    ]);
    expect(p.rows[0].payee).toHaveLength(200);
  });

  it("follows the currency's digits", () => {
    const yen: Ledger = { ...emptyLedger(), settings: { currency: "JPY" } };
    const p = ok(planImport("d,p,a\n2026-01-01,Shop,-1200\n2026-01-02,Cafe,-3.50", COMMA, yen));
    expect(brief(p)).toEqual([[2, "2026-01-01", "Shop", -1200]]);
    expect(p.rejected[0].reason).toContain("more than 0 decimal places");
  });
});

describe("duplicates", () => {
  const ledgerWith = (rows: [string, string, number][]): Ledger => ({
    ...emptyLedger(),
    transactions: rows.map(([date, payee, amount], i) => ({ id: `t${i + 1}`, date, payee, amount, categoryId: null, note: "" })),
    nextId: rows.length + 1,
  });

  it("skips and counts rows identical in date, amount and payee to one already there", () => {
    const ledger = ledgerWith([["2026-10-05", "Bakery", -480], ["2026-10-02", "Corner shop", -1250]]);
    const p = ok(planImport(fixture("bank-comma.csv"), COMMA, ledger));
    expect(p.duplicates).toBe(2);
    expect(p.rows.map((r) => r.line)).toEqual([2, 4, 5, 6]);
  });

  it("a different amount, date or payee is not a duplicate", () => {
    const ledger = ledgerWith([["2026-10-05", "Bakery", -481], ["2026-10-06", "Bakery", -480], ["2026-10-05", "Bakery ", -480]]);
    expect(ok(planImport(fixture("bank-comma.csv"), COMMA, ledger)).duplicates).toBe(0);
  });

  it("each existing transaction absorbs one row: repeated rows import once, then all skip", () => {
    const once = ledgerWith([["2026-10-03", "Corner shop", -1250]]);
    const p = ok(planImport(fixture("bank-comma.csv"), COMMA, once));
    expect(p.duplicates).toBe(1);
    expect(p.rows.filter((r) => r.date === "2026-10-03" && r.payee === "Corner shop")).toHaveLength(1);
  });
});

describe("checkMapping", () => {
  it("accepts a well-formed mapping and refuses a malformed one", () => {
    expect(ok(checkMapping(COMMA))).toEqual(COMMA);
    expect(checkMapping({ ...COMMA, delimiter: ":" }).ok).toBe(false);
    expect(checkMapping({ ...COMMA, headerRow: -1 }).ok).toBe(false);
    expect(checkMapping({ ...COMMA, date: 1.5 }).ok).toBe(false);
    expect(checkMapping({ ...COMMA, amount: { kind: "split", debit: 2, credit: 2 } }).ok).toBe(false);
    expect(checkMapping({ ...COMMA, dateOrder: "DDD" }).ok).toBe(false);
    expect(checkMapping({ ...COMMA, decimal: " " }).ok).toBe(false);
    expect(checkMapping(null).ok).toBe(false);
  });
});

describe("importing through the service: all or none", () => {
  const store = (fail: () => boolean): LedgerStore => ({ file: "t", save: async () => { if (fail()) throw new Error("disk full"); } });

  it("adds every accepted row together and reports the counts", async () => {
    const service = new TallyService({ ledger: emptyLedger(), status: { kind: "ok" } }, store(() => false));
    const r = ok(await service.importCsv(fixture("bank-comma.csv"), COMMA));
    expect([r.added, r.duplicates, r.rejected]).toEqual([6, 0, 2]);
    expect(r.snapshot.transactions).toHaveLength(6);
    const again = ok(await service.importCsv(fixture("bank-comma.csv"), COMMA));
    expect([again.added, again.duplicates, again.rejected]).toEqual([0, 6, 2]);
    expect(again.snapshot.transactions).toHaveLength(6);
  });

  it("adds nothing when the save fails or the mapping is broken", async () => {
    let failing = true;
    const service = new TallyService({ ledger: emptyLedger(), status: { kind: "ok" } }, store(() => failing));
    const r = await service.importCsv(fixture("bank-comma.csv"), COMMA);
    expect(r.ok ? "ok" : r.error.code).toBe("io");
    failing = false;
    const broken = await service.importCsv(fixture("bank-comma.csv"), { ...COMMA, decimal: "x" as "." });
    expect(broken.ok ? "ok" : broken.error.code).toBe("invalid");
    expect((await service.load()).transactions).toHaveLength(0);
  });
});
