// L1: categories (create, rename, delete, merge) and payee rules (matching,
// applying to uncategorised transactions and to imported rows).
import { describe, expect, it } from "vitest";
import type { ImportMapping, Result } from "../../contracts/tally";
import * as cat from "../../core/categories";
import { planImport } from "../../core/import-plan";
import { emptyLedger, type Ledger, toSnapshot } from "../../core/ledger";
import { addTransaction } from "../../core/transactions";

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
const err = <T>(r: Result<T>) => (r.ok ? "ok" : `${r.error.code}${r.error.field ? `/${r.error.field}` : ""}`);

function ledger(): Ledger {
  let l = emptyLedger();
  l = ok(cat.createCategory(l, "Groceries")); // c1
  l = ok(cat.createCategory(l, "Eating out")); // c2
  for (const [payee, categoryId] of [["Corner SHOP", "c1"], ["Cafe Luna", "c2"], ["Cinema", null], ["Farm shop", null]] as const) {
    l = ok(addTransaction(l, { date: "2026-10-01", payee, amount: -500, categoryId, note: "" }));
  }
  return l;
}

describe("categories", () => {
  it("creates with a clean name and keeps names unique ignoring case", () => {
    const l = ok(cat.createCategory(emptyLedger(), "  Day   trips "));
    expect(l.categories).toEqual([{ id: "c1", name: "Day trips" }]);
    expect(err(cat.createCategory(l, "day TRIPS"))).toBe("invalid/name");
    expect(err(cat.createCategory(l, "   "))).toBe("invalid/name");
    expect(err(cat.createCategory(l, "x".repeat(61)))).toBe("invalid/name");
  });

  it("lists categories by name, ignoring case", () => {
    let l = emptyLedger();
    for (const name of ["travel", "Bills", "groceries"]) l = ok(cat.createCategory(l, name));
    expect(toSnapshot(l, { kind: "ok" }, "m").categories.map((c) => c.name)).toEqual(["Bills", "groceries", "travel"]);
  });

  it("renames, refusing a name another category has but allowing a change of case", () => {
    const l = ledger();
    expect(ok(cat.renameCategory(l, "c1", "Food")).categories[0].name).toBe("Food");
    expect(ok(cat.renameCategory(l, "c1", "GROCERIES")).categories[0].name).toBe("GROCERIES");
    expect(err(cat.renameCategory(l, "c1", "eating out"))).toBe("invalid/name");
    expect(err(cat.renameCategory(l, "c9", "x"))).toBe("not_found");
  });

  it("deleting a category leaves its transactions uncategorised and removes its rules", () => {
    let l = ok(cat.createRule(ledger(), "shop", "c1"));
    l = ok(cat.deleteCategory(l, "c1"));
    expect(l.categories.map((c) => c.id)).toEqual(["c2"]);
    expect(l.transactions.map((t) => t.categoryId)).toEqual([null, "c2", null, null]);
    expect(l.rules).toEqual([]);
    expect(err(cat.deleteCategory(l, "c1"))).toBe("not_found");
  });

  it("merging moves transactions and rules to the target and removes the source", () => {
    let l = ok(cat.createRule(ledger(), "cafe", "c2"));
    l = ok(cat.createRule(l, "CAFE", "c1"));
    l = ok(cat.mergeCategories(l, "c2", "c1"));
    expect(l.categories.map((c) => c.id)).toEqual(["c1"]);
    expect(l.transactions.map((t) => t.categoryId)).toEqual(["c1", "c1", null, null]);
    // The moved rule now duplicates the target's own rule, so one is kept.
    expect(l.rules).toEqual([{ id: "r7", contains: "cafe", categoryId: "c1" }]);
    expect(err(cat.mergeCategories(l, "c1", "c1"))).toBe("invalid/into");
    expect(err(cat.mergeCategories(l, "c2", "c1"))).toBe("not_found");
  });
});

describe("rules", () => {
  it("are checked: text, an existing category, no duplicates", () => {
    const l = ok(cat.createRule(ledger(), "  corner  shop ", "c1"));
    expect(l.rules).toEqual([{ id: "r7", contains: "corner shop", categoryId: "c1" }]);
    expect(err(cat.createRule(l, "Corner Shop", "c1"))).toBe("invalid/contains");
    expect(err(cat.createRule(l, "", "c1"))).toBe("invalid/contains");
    expect(err(cat.createRule(l, "x", "c9"))).toBe("invalid/categoryId");
    expect(ok(cat.deleteRule(l, "r7")).rules).toEqual([]);
    expect(err(cat.deleteRule(l, "r9"))).toBe("not_found");
  });

  it("match payee text ignoring case, and the oldest matching rule wins", () => {
    const rules = [
      { id: "r1", contains: "shop", categoryId: "c1" },
      { id: "r2", contains: "farm", categoryId: "c2" },
    ];
    expect(cat.matchRule(rules, "FARM SHOP")).toBe("c1");
    expect(cat.matchRule(rules, "Farmers market")).toBe("c2");
    expect(cat.matchRule(rules, "Cinema")).toBeNull();
  });

  it("applied on request, change only uncategorised transactions and count them", () => {
    let l = ok(cat.createRule(ledger(), "shop", "c2"));
    const applied = cat.applyRules(l);
    expect(applied.changed).toBe(1);
    // "Corner SHOP" already had Groceries and keeps it; "Farm shop" gets the rule's category.
    expect(applied.ledger.transactions.map((t) => [t.payee, t.categoryId])).toEqual([
      ["Corner SHOP", "c1"], ["Cafe Luna", "c2"], ["Cinema", null], ["Farm shop", "c2"],
    ]);
    l = applied.ledger;
    expect(cat.applyRules(l).changed).toBe(0);
  });

  it("categorise imported rows", () => {
    const l = ok(cat.createRule(ledger(), "bakery", "c2"));
    const mapping: ImportMapping = { delimiter: ",", headerRow: 0, date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "YMD", decimal: "." };
    const plan = ok(planImport("d,p,a\n2026-10-09,Village Bakery,-3.20\n2026-10-09,Garage,-40.00", mapping, l));
    expect(plan.rows.map((r) => [r.payee, r.categoryId])).toEqual([["Village Bakery", "c2"], ["Garage", null]]);
  });
});
