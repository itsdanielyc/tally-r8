// L1: the rules a transaction must meet, adding, editing and deleting, the
// newest-first order, and the currency rule.
import { describe, expect, it } from "vitest";
import type { Result, TransactionInput } from "../../contracts/tally";
import { emptyLedger, type Ledger, toSnapshot } from "../../core/ledger";
import { setCurrency } from "../../core/settings";
import { addTransaction, deleteTransaction, updateTransaction, validateInput } from "../../core/transactions";

const input = (over: Partial<TransactionInput> = {}): TransactionInput => ({
  date: "2026-11-18",
  payee: "Corner shop",
  amount: -1250,
  categoryId: null,
  note: "",
  ...over,
});

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r.value;
}

function errorOf<T>(r: Result<T>): { code: string; field?: string } {
  if (r.ok) throw new Error("expected an error");
  return { code: r.error.code, field: r.error.field };
}

describe("validateInput", () => {
  const ledger = emptyLedger();

  it("cleans the payee and note and keeps the amount exact", () => {
    const v = ok(validateInput(input({ payee: "  Corner \t  shop ", note: "  milk  " }), ledger));
    expect(v).toEqual({ date: "2026-11-18", payee: "Corner shop", amount: -1250, categoryId: null, note: "milk" });
  });

  it("names the field at fault", () => {
    expect(errorOf(validateInput(input({ date: "2026-02-30" }), ledger))).toEqual({ code: "invalid", field: "date" });
    expect(errorOf(validateInput(input({ payee: "   " }), ledger))).toEqual({ code: "invalid", field: "payee" });
    expect(errorOf(validateInput(input({ payee: "x".repeat(201) }), ledger))).toEqual({ code: "invalid", field: "payee" });
    expect(errorOf(validateInput(input({ amount: 0 }), ledger))).toEqual({ code: "invalid", field: "amount" });
    expect(errorOf(validateInput(input({ amount: 12.5 }), ledger))).toEqual({ code: "invalid", field: "amount" });
    expect(errorOf(validateInput(input({ amount: 1_000_000_000_001 }), ledger))).toEqual({ code: "invalid", field: "amount" });
    expect(errorOf(validateInput(input({ categoryId: "c99" }), ledger))).toEqual({ code: "invalid", field: "categoryId" });
    expect(errorOf(validateInput(input({ note: "n".repeat(1001) }), ledger))).toEqual({ code: "invalid", field: "note" });
  });

  it("treats a renderer's malformed value as invalid, not as a crash", () => {
    expect(errorOf(validateInput(null, ledger)).field).toBe("date");
    expect(errorOf(validateInput({ ...input(), amount: "12" }, ledger)).field).toBe("amount");
    expect(errorOf(validateInput({ ...input(), payee: 7 }, ledger)).field).toBe("payee");
    expect(errorOf(validateInput({ ...input(), note: 7 }, ledger)).field).toBe("note");
  });
});

describe("add, edit, delete", () => {
  it("adds with a fresh id each time and never reuses one", () => {
    let l: Ledger = emptyLedger();
    l = ok(addTransaction(l, input()));
    l = ok(addTransaction(l, input({ payee: "Bakery" })));
    l = ok(deleteTransaction(l, "t2"));
    l = ok(addTransaction(l, input({ payee: "Market" })));
    expect(l.transactions.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("edits every field but the id", () => {
    let l = ok(addTransaction(emptyLedger(), input()));
    l = ok(updateTransaction(l, "t1", input({ date: "2026-01-02", payee: "Bakery", amount: 300, note: "refund" })));
    expect(l.transactions).toEqual([{ id: "t1", date: "2026-01-02", payee: "Bakery", amount: 300, categoryId: null, note: "refund" }]);
  });

  it("reports an unknown id and an invalid edit without changing anything", () => {
    const l = ok(addTransaction(emptyLedger(), input()));
    expect(errorOf(updateTransaction(l, "t9", input())).code).toBe("not_found");
    expect(errorOf(deleteTransaction(l, "t9")).code).toBe("not_found");
    expect(errorOf(updateTransaction(l, "t1", input({ payee: "" }))).field).toBe("payee");
    expect(l.transactions).toHaveLength(1);
  });

  it("lists newest date first, and the most recently added first on the same date", () => {
    let l: Ledger = emptyLedger();
    for (const [date, payee] of [["2026-03-01", "a"], ["2026-05-01", "b"], ["2026-03-01", "c"], ["2025-12-31", "d"]]) {
      l = ok(addTransaction(l, input({ date, payee })));
    }
    const shown = toSnapshot(l, { kind: "ok" }, "memory").transactions.map((t) => t.payee);
    expect(shown).toEqual(["b", "c", "a", "d"]);
  });
});

describe("currency", () => {
  it("changes freely while the ledger is empty", () => {
    expect(ok(setCurrency(emptyLedger(), "JPY")).settings.currency).toBe("JPY");
  });

  it("refuses an unknown code", () => {
    expect(errorOf(setCurrency(emptyLedger(), "XYZ"))).toEqual({ code: "invalid", field: "currency" });
  });

  it("with transactions, changes only to a currency with the same minor digits", () => {
    const l = ok(addTransaction(emptyLedger(), input()));
    expect(ok(setCurrency(l, "EUR")).settings.currency).toBe("EUR");
    expect(errorOf(setCurrency(l, "JPY"))).toEqual({ code: "invalid", field: "currency" });
    expect(errorOf(setCurrency(l, "BHD"))).toEqual({ code: "invalid", field: "currency" });
  });
});
