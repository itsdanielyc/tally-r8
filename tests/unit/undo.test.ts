// L1: undo. The most recent delete (of a transaction or a category), merge or
// import can be undone once, immediately afterwards; any other change forgets
// it; a failed save leaves it available.
import { describe, expect, it } from "vitest";
import type { ImportMapping, Result, Snapshot, TransactionInput } from "../../contracts/tally";
import { emptyLedger } from "../../core/ledger";
import { type LedgerStore, TallyService } from "../../core/service";

const tx = (payee: string, date = "2026-11-02"): TransactionInput => ({ date, payee, amount: -100, categoryId: null, note: "" });
const MAPPING: ImportMapping = { delimiter: ",", headerRow: 0, date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "YMD", decimal: "." };
const CSV = "Date,Payee,Amount\n2026-11-05,Imported A,-1.00\n2026-11-06,Imported B,-2.00\n";

function ok<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
const code = <T>(r: Result<T>) => (r.ok ? "ok" : r.error.code);
const payees = (s: Snapshot) => s.transactions.map((t) => t.payee);

async function service(fail = () => false): Promise<TallyService> {
  const store: LedgerStore = { file: "t", save: async () => { if (fail()) throw new Error("disk full"); } };
  const s = new TallyService({ ledger: emptyLedger(), status: { kind: "ok" } }, store);
  for (const p of ["One", "Two", "Three"]) ok(await s.addTransaction(tx(p)));
  return s;
}

describe("undo", () => {
  it("has nothing to undo after adds and edits", async () => {
    const s = await service();
    expect((await s.load()).undo).toBeNull();
    expect(code(await s.undo())).toBe("not_found");
  });

  it("brings back a deleted transaction, once", async () => {
    const s = await service();
    const deleted = ok(await s.deleteTransaction("t2"));
    expect(deleted.undo).toEqual({ label: 'Deleted the transaction "Two" of 2026-11-02' });
    const back = ok(await s.undo());
    expect(payees(back)).toEqual(["Three", "Two", "One"]);
    expect(back.undo).toBeNull();
    expect(code(await s.undo())).toBe("not_found");
  });

  it("brings back a deleted category with its transactions' links and rules", async () => {
    const s = await service();
    ok(await s.createCategory("Food")); // c4
    ok(await s.updateTransaction("t1", { ...tx("One"), categoryId: "c4" }));
    ok(await s.createRule("one", "c4"));
    expect(ok(await s.deleteCategory("c4")).undo?.label).toBe('Deleted the category "Food"');
    const back = ok(await s.undo());
    expect(back.categories.map((c) => c.name)).toEqual(["Food"]);
    expect(back.transactions.find((t) => t.id === "t1")?.categoryId).toBe("c4");
    expect(back.rules).toHaveLength(1);
  });

  it("splits a merge back into two categories", async () => {
    const s = await service();
    ok(await s.createCategory("Cafes")); // c4
    ok(await s.createCategory("Eating out")); // c5
    ok(await s.updateTransaction("t1", { ...tx("One"), categoryId: "c4" }));
    expect(ok(await s.mergeCategories("c4", "c5")).undo?.label).toBe('Merged "Cafes" into "Eating out"');
    const back = ok(await s.undo());
    expect(back.categories.map((c) => c.id)).toEqual(["c4", "c5"]);
    expect(back.transactions.find((t) => t.id === "t1")?.categoryId).toBe("c4");
  });

  it("removes every row of an import, and never hands out their ids again", async () => {
    const s = await service();
    const imported = ok(await s.importCsv(CSV, MAPPING));
    expect(imported.snapshot.undo?.label).toBe("Imported 2 transactions");
    expect(payees(ok(await s.undo()))).toEqual(["Three", "Two", "One"]);
    const next = ok(await s.addTransaction(tx("Four")));
    expect(next.transactions.find((t) => t.payee === "Four")?.id).toBe("t6");
  });

  it("an import that adds nothing changes nothing, so what could be undone stays", async () => {
    const s = await service();
    ok(await s.deleteTransaction("t3"));
    ok(await s.importCsv(CSV, MAPPING));
    ok(await s.undo()); // undoes the import
    const again = ok(await s.importCsv(CSV, MAPPING));
    expect(again.added).toBe(2);
    const dup = ok(await s.importCsv(CSV, MAPPING));
    expect([dup.added, dup.snapshot.undo?.label]).toEqual([0, "Imported 2 transactions"]);
  });

  it("is forgotten by any other change", async () => {
    const s = await service();
    ok(await s.deleteTransaction("t1"));
    ok(await s.addTransaction(tx("Four")));
    expect(code(await s.undo())).toBe("not_found");
    ok(await s.deleteTransaction("t2"));
    ok(await s.setCurrency("EUR"));
    expect(code(await s.undo())).toBe("not_found");
  });

  // Bug hunt L4: saving an edit that changes nothing used to forget the undo.
  it("a save that changes nothing keeps it, and writes nothing", async () => {
    let saves = 0;
    const store: LedgerStore = { file: "t", save: async () => { saves++; } };
    const s = new TallyService({ ledger: emptyLedger(), status: { kind: "ok" } }, store);
    ok(await s.addTransaction(tx("One")));
    ok(await s.addTransaction(tx("Two")));
    ok(await s.createCategory("Food")); // c3
    ok(await s.setBudget("c3", 500));
    ok(await s.deleteTransaction("t2"));
    const before = saves;
    ok(await s.updateTransaction("t1", { ...tx("  One "), note: " " }));
    ok(await s.renameCategory("c3", "Food"));
    ok(await s.setBudget("c3", 500));
    ok(await s.setCurrency("USD"));
    expect(saves).toBe(before);
    expect((await s.load()).undo?.label).toBe('Deleted the transaction "Two" of 2026-11-02');
    expect(payees(ok(await s.undo()))).toEqual(["Two", "One"]);
  });

  it("a refused change does not forget it", async () => {
    const s = await service();
    ok(await s.deleteTransaction("t1"));
    expect(code(await s.addTransaction(tx("")))).toBe("invalid");
    expect(payees(ok(await s.undo()))).toContain("One");
  });

  it("survives a failed save of the undo itself, and works when the disk is back", async () => {
    let failing = false;
    const s = await service(() => failing);
    ok(await s.deleteTransaction("t1"));
    failing = true;
    expect(code(await s.undo())).toBe("io");
    expect(payees(await s.load())).not.toContain("One");
    failing = false;
    expect(payees(ok(await s.undo()))).toContain("One");
  });
});
