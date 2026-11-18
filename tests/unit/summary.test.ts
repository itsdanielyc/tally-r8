// L1: the monthly summary and budgets. Totals per category, income against
// spending, left or over, month boundaries; and for thousands of generated
// mixes of income and spending, the totals equal the sum of the month's
// transactions to the minor unit.
import { describe, expect, it } from "vitest";
import type { Category, Result, Transaction } from "../../contracts/tally";
import { createCategory, setBudget } from "../../core/categories";
import { emptyLedger } from "../../core/ledger";
import { addMonths, isMonth, monthLabel, monthSummary } from "../../core/summary";

const t = (id: string, date: string, amount: number, categoryId: string | null = null): Transaction =>
  ({ id, date, payee: id, amount, categoryId, note: "" });

const cats: Category[] = [
  { id: "c1", name: "Groceries", budget: 40000 },
  { id: "c2", name: "Eating out", budget: 10000 },
  { id: "c3", name: "Travel", budget: null },
  { id: "c4", name: "Gifts", budget: null },
];

describe("monthSummary", () => {
  const txs = [
    t("a", "2026-10-31", -5000, "c1"), // October: not counted
    t("b", "2026-11-01", -12000, "c1"),
    t("c", "2026-11-15", 1500, "c1"), // a refund reduces what Groceries spent
    t("d", "2026-11-30", -12500, "c2"),
    t("e", "2026-11-20", 300000, null),
    t("f", "2026-11-21", -999, null),
    t("g", "2026-12-01", -7000, "c3"), // December: not counted
  ];

  it("counts only the month's own days, first and last included", () => {
    expect(monthSummary("2026-11", txs, cats).transactions.map((x) => x.id)).toEqual(["b", "c", "d", "e", "f"]);
  });

  it("gives income against spending and the net", () => {
    const s = monthSummary("2026-11", txs, cats);
    expect([s.income, s.spending, s.net]).toEqual([301500, 25499, 276001]);
  });

  it("gives each category its total, what it spent against its budget, and what is left or over", () => {
    expect(monthSummary("2026-11", txs, cats).lines).toEqual([
      { id: "c1", name: "Groceries", total: -10500, spent: 10500, budget: 40000, left: 29500 },
      { id: "c2", name: "Eating out", total: -12500, spent: 12500, budget: 10000, left: -2500 },
      { id: null, name: "Uncategorised", total: 299001, spent: -299001, budget: null, left: null },
    ]);
  });

  it("shows a category with a budget even in a month it was not used, and hides an unused one without", () => {
    const s = monthSummary("2027-01", txs, cats);
    expect(s.lines.map((l) => [l.name, l.total, l.left])).toEqual([["Groceries", 0, 40000], ["Eating out", 0, 10000]]);
    expect([s.income, s.spending, s.net]).toEqual([0, 0, 0]);
  });

  it("counts a link to a category that no longer exists as uncategorised", () => {
    const s = monthSummary("2026-11", [t("x", "2026-11-02", -100, "c99")], cats);
    expect(s.lines.at(-1)).toEqual({ id: null, name: "Uncategorised", total: -100, spent: 100, budget: null, left: null });
    expect(s.lines.reduce((sum, l) => sum + l.total, 0)).toBe(s.net);
  });
});

/** A small deterministic generator, so a failure names the seed that found it. */
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

describe("totals add up to the cent for any mix", () => {
  it("for 500 generated ledgers, every month's lines, income and spending equal the sum of its transactions", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = rng(seed);
      const n = Math.floor(r() * 60);
      const txs = Array.from({ length: n }, (_, i) => {
        const month = String(Math.floor(r() * 12) + 1).padStart(2, "0");
        const day = String(Math.floor(r() * 28) + 1).padStart(2, "0");
        const magnitude = Math.floor(r() * 1_000_000_000) + 1;
        const amount = r() < 0.3 ? magnitude : -magnitude;
        const categoryId = r() < 0.2 ? null : cats[Math.floor(r() * cats.length)].id;
        return t(`t${i}`, `2026-${month}-${day}`, amount, categoryId);
      });
      for (let m = 1; m <= 12; m++) {
        const month = `2026-${String(m).padStart(2, "0")}`;
        const s = monthSummary(month, txs, cats);
        const shown = s.transactions.reduce((sum, x) => sum + x.amount, 0);
        const lines = s.lines.reduce((sum, l) => sum + l.total, 0);
        expect(lines, `seed ${seed}, ${month}`).toBe(shown);
        expect(s.net, `seed ${seed}, ${month}`).toBe(shown);
        expect(s.income - s.spending, `seed ${seed}, ${month}`).toBe(shown);
        expect(Number.isSafeInteger(lines)).toBe(true);
      }
    }
  });
});

describe("months", () => {
  it("steps across year ends and names months in words", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-05", -17)).toBe("2024-12");
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(isMonth("2026-11")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
  });
});

describe("budgets", () => {
  function ok<T>(r: Result<T>): T {
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  }
  const l = ok(createCategory(emptyLedger(), "Groceries"));

  it("are set, changed and removed per category", () => {
    let x = ok(setBudget(l, "c1", 40000));
    expect(x.categories[0].budget).toBe(40000);
    x = ok(setBudget(x, "c1", null));
    expect(x.categories[0].budget).toBeNull();
  });

  it("must be a positive whole number of minor units on a category that exists", () => {
    for (const bad of [0, -100, 12.5, Number.NaN, 2_000_000_000_000]) expect(setBudget(l, "c1", bad).ok).toBe(false);
    expect(setBudget(l, "c9", 100).ok).toBe(false);
  });
});
