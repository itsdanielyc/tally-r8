// L1: the export. An exported CSV imports back into an empty ledger as the
// same transactions: date, payee, amount, category and note, for awkward
// payees and notes, any currency's digits, and a filtered set.
import { describe, expect, it } from "vitest";
import type { Result, Transaction } from "../../contracts/tally";
import { inspectCsv } from "../../core/csv-inspect";
import { exportCsv } from "../../core/csv-export";
import { applyImport, planImport } from "../../core/import-plan";
import { emptyLedger, type Ledger, toSnapshot } from "../../core/ledger";

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/** What "the same transaction" means across ledgers: everything but the id, with the category by name. */
function portable(l: Ledger): string[][] {
  const name = (id: string | null) => l.categories.find((c) => c.id === id)?.name ?? "";
  return toSnapshot(l, { kind: "ok" }, "m").transactions.map((t) => [t.date, t.payee, String(t.amount), name(t.categoryId), t.note]);
}

function source(currency = "USD"): Ledger {
  type Row = [id: string, date: string, payee: string, amount: number, categoryId: string | null, note: string];
  const tx = ([id, date, payee, amount, categoryId, note]: Row): Transaction =>
    ({ id, date, payee, amount, categoryId, note });
  return {
    ...emptyLedger(),
    settings: { currency },
    categories: [{ id: "c1", name: "Groceries", budget: 40000 }, { id: "c2", name: "Gifts, cards & co", budget: null }],
    transactions: [
      tx(["t3", "2026-11-02", "Corner shop", -1250, "c1", "milk"]),
      tx(["t4", "2026-11-02", 'Shop "Deluxe", Ltd', -999, "c2", 'said "thanks"']),
      tx(["t5", "2026-11-01", "Employer", 320000, null, ""]),
      tx(["t6", "2026-10-31", "Café Ünïcode", -5, null, "two\nlines, and a comma"]),
      tx(["t7", "2026-10-31", "=SUM(A1)", -100000000, "c1", "-starts with a minus"]),
    ],
    nextId: 8,
  };
}

function roundTrip(l: Ledger, shown = toSnapshot(l, { kind: "ok" }, "m").transactions): Ledger {
  const csv = exportCsv(shown, l.categories, l.settings.currency);
  const target: Ledger = { ...emptyLedger(), settings: { ...l.settings } };
  const inspection = inspectCsv(csv);
  return applyImport(target, ok(planImport(csv, inspection.mapping, target)));
}

describe("exportCsv", () => {
  it("writes a header, signed amounts with a decimal point, the category by name and quotes where needed", () => {
    const l = source();
    const csv = exportCsv(toSnapshot(l, { kind: "ok" }, "m").transactions.slice(0, 3), l.categories, "USD");
    expect(csv).toBe([
      "Date,Payee,Amount,Category,Note",
      "2026-11-01,Employer,3200.00,,",
      "2026-11-02,Corner shop,-12.50,Groceries,milk",
      '2026-11-02,"Shop ""Deluxe"", Ltd",-9.99,"Gifts, cards & co","said ""thanks"""',
      "",
    ].join("\r\n"));
  });

  it("is recognised by Tally's import, category and note columns included", () => {
    const l = source();
    const i = inspectCsv(exportCsv(toSnapshot(l, { kind: "ok" }, "m").transactions, l.categories, "USD"));
    expect(i.mapping).toEqual({ delimiter: ",", headerRow: 0, date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "YMD", decimal: ".", category: 3, note: 4 });
  });

  it("imports back into an empty ledger as the same transactions, in the same order", () => {
    const l = source();
    const back = roundTrip(l);
    expect(portable(back)).toEqual(portable(l));
    expect(back.categories.map((c) => c.name).sort()).toEqual(["Gifts, cards & co", "Groceries"]);
  });

  it("round-trips in a currency with no minor digits and one with three", () => {
    for (const currency of ["JPY", "BHD"]) {
      const l = source(currency);
      expect(portable(roundTrip(l)), currency).toEqual(portable(l));
    }
  });

  it("exports exactly the transactions shown, and those come back", () => {
    const l = source();
    const shown = toSnapshot(l, { kind: "ok" }, "m").transactions.filter((t) => t.categoryId === "c1");
    const back = roundTrip(l, shown);
    expect(portable(back).map((r) => r[1])).toEqual(["Corner shop", "=SUM(A1)"]);
    expect(back.categories.map((c) => c.name)).toEqual(["Groceries"]);
  });
});
