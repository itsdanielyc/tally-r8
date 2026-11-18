// L1: the one save pipeline. Changes run one at a time, memory changes only
// after the store has saved, and a ledger that was not opened refuses changes.
import { describe, expect, it } from "vitest";
import type { TransactionInput } from "../../contracts/tally";
import { emptyLedger, type Ledger } from "../../core/ledger";
import { type LedgerStore, TallyService } from "../../core/service";

const input = (payee: string): TransactionInput => ({ date: "2026-11-18", payee, amount: -100, categoryId: null, note: "" });

function recordingStore(fail = () => false): LedgerStore & { saved: Ledger[] } {
  const saved: Ledger[] = [];
  return {
    file: "test",
    saved,
    async save(ledger) {
      await new Promise((r) => setTimeout(r, 1));
      if (fail()) throw new Error("disk full");
      saved.push(ledger);
    },
  };
}

describe("TallyService", () => {
  it("saves every change, in order, even when they are sent at once", async () => {
    const store = recordingStore();
    const service = new TallyService({ ledger: emptyLedger(), status: { kind: "ok" } }, store);
    const results = await Promise.all(["a", "b", "c"].map((p) => service.addTransaction(input(p))));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(store.saved.map((l) => l.transactions.length)).toEqual([1, 2, 3]);
    expect((await service.load()).transactions.map((t) => t.payee)).toEqual(["c", "b", "a"]);
  });

  it("keeps memory unchanged and reports io when the save fails", async () => {
    let failing = false;
    const service = new TallyService({ ledger: emptyLedger(), status: { kind: "ok" } }, recordingStore(() => failing));
    await service.addTransaction(input("kept"));
    failing = true;
    const r = await service.addTransaction(input("lost"));
    expect(r.ok ? "ok" : r.error.code).toBe("io");
    expect((await service.load()).transactions.map((t) => t.payee)).toEqual(["kept"]);
    failing = false;
    const again = await service.addTransaction(input("next"));
    expect(again.ok && again.value.transactions.map((t) => t.payee)).toEqual(["next", "kept"]);
  });

  it("does not save a change that fails validation", async () => {
    const store = recordingStore();
    const service = new TallyService({ ledger: emptyLedger(), status: { kind: "ok" } }, store);
    const r = await service.addTransaction(input(""));
    expect(r.ok ? "ok" : r.error.field).toBe("payee");
    expect(store.saved).toHaveLength(0);
  });

  it("refuses every change when the ledger file could not be opened", async () => {
    const store = recordingStore();
    const status = { kind: "unreadable" as const, message: "not JSON" };
    const service = new TallyService({ ledger: emptyLedger(), status }, store);
    const r = await service.addTransaction(input("a"));
    expect(r.ok ? "ok" : r.error.code).toBe("readonly");
    expect(store.saved).toHaveLength(0);
    expect((await service.load()).status).toEqual(status);
  });

  it("hands out copies, so a caller cannot change the ledger behind its back", async () => {
    const service = new TallyService({ ledger: emptyLedger(), status: { kind: "ok" } }, recordingStore());
    const r = await service.addTransaction(input("a"));
    if (r.ok) r.value.transactions[0].payee = "changed";
    expect((await service.load()).transactions[0].payee).toBe("a");
  });
});
