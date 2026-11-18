// L1: finding transactions by text, category, date range and amount range.
import { describe, expect, it } from "vitest";
import type { Transaction } from "../../contracts/tally";
import { applyFilter, type Filter, isFiltered, NO_FILTER } from "../../core/filter";

type Row = [id: string, date: string, payee: string, amount: number, categoryId: string | null, note?: string];
const t = ([id, date, payee, amount, categoryId, note = ""]: Row): Transaction =>
  ({ id, date, payee, amount, categoryId, note });

const txs = [
  t(["a", "2026-11-30", "Corner shop", -1250, "c1", "milk and EGGS"]),
  t(["b", "2026-11-15", "Employer", 320000, null]),
  t(["c", "2026-11-01", "Cinema", -900, "c2", "with Sam"]),
  t(["d", "2026-10-31", "Corner Deli", -5000, "c1"]),
];

const run = (f: Partial<Filter>) => applyFilter(txs, { ...NO_FILTER, ...f }, 2);
const ids = (f: Partial<Filter>) => run(f).shown.map((x) => x.id);

describe("applyFilter", () => {
  it("keeps everything, in order, when nothing is set", () => {
    expect(ids({})).toEqual(["a", "b", "c", "d"]);
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, text: "x" })).toBe(true);
  });

  it("searches payee and note text, ignoring case", () => {
    expect(ids({ text: "corner" })).toEqual(["a", "d"]);
    expect(ids({ text: "eggs" })).toEqual(["a"]);
    expect(ids({ text: "  SAM " })).toEqual(["c"]);
  });

  it("filters by a category, or by uncategorised", () => {
    expect(ids({ category: "c1" })).toEqual(["a", "d"]);
    expect(ids({ category: "none" })).toEqual(["b"]);
  });

  it("filters by a date range, both ends included", () => {
    expect(ids({ from: "2026-11-01", to: "2026-11-15" })).toEqual(["b", "c"]);
    expect(ids({ to: "2026-10-31" })).toEqual(["d"]);
    expect(ids({ from: "2026-11-30" })).toEqual(["a"]);
  });

  it("filters by the size of an amount, spending or income, both ends included", () => {
    expect(ids({ min: "9", max: "50" })).toEqual(["a", "c", "d"]);
    expect(ids({ min: "12.50", max: "12.50" })).toEqual(["a"]);
    expect(ids({ min: "1000" })).toEqual(["b"]);
  });

  it("combines every condition", () => {
    expect(ids({ text: "corner", category: "c1", from: "2026-11-01", max: "20" })).toEqual(["a"]);
  });

  it("reports what it cannot read and ignores that part", () => {
    const r = run({ from: "31/10/2026", min: "lots" });
    expect(r.problems).toEqual(["From must be a real day, as YYYY-MM-DD.", 'At least: Amount "lots" is not a number.']);
    expect(r.shown).toHaveLength(4);
  });
});
