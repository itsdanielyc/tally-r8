// L3: the ledger file on a real disk. A save interrupted at any step leaves a
// ledger that opens with the state from before the change; a file Tally cannot
// read, or one a newer Tally wrote, is never written over; every file version
// ever written keeps opening (fixtures/).
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TransactionInput } from "../../contracts/tally";
import { openBackend } from "../../electron/backend";
import { LEDGER_FILE, realOps, renameWithRetry, type SaveOps } from "../../electron/store";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "tally-store-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const tx = (payee: string, amount = -1250): TransactionInput => ({ date: "2026-11-18", payee, amount, categoryId: null, note: "" });
const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);

describe("saving and reopening", () => {
  it("starts empty without creating a file, and writes a versioned file on the first change", async () => {
    const dir = tempDir();
    const service = await openBackend(dir);
    expect((await service.load()).transactions).toEqual([]);
    expect(existsSync(join(dir, LEDGER_FILE))).toBe(false);
    await service.addTransaction(tx("Corner shop"));
    const doc = JSON.parse(readFileSync(join(dir, LEDGER_FILE), "utf8"));
    expect(doc.version).toBe(2);
    expect(doc.transactions).toEqual([{ id: "t1", ...tx("Corner shop") }]);
  });

  it("reopens with every transaction unchanged, to the minor unit", async () => {
    const dir = tempDir();
    const first = await openBackend(dir);
    await first.setCurrency("EUR");
    await first.addTransaction({ date: "2024-02-29", payee: "Ünïcode café", amount: -999_999_999_999, categoryId: null, note: "line\nbreak" });
    await first.addTransaction(tx("Employer", 1));
    const before = await first.load();
    const after = await (await openBackend(dir)).load();
    expect(after).toEqual(before);
  });
});

type Step = "writeTemp" | "tornWrite" | "rename";

/** Real file operations with one step made to fail as a crash would. */
function failingAt(step: Step): SaveOps {
  return {
    async writeTemp(path, data) {
      if (step === "writeTemp") throw new Error("crash before the temp file was written");
      if (step === "tornWrite") {
        writeFileSync(path, data.slice(0, Math.floor(data.length / 2)));
        throw new Error("crash halfway through writing the temp file");
      }
      return realOps.writeTemp(path, data);
    },
    async rename(from, to) {
      if (step === "rename") throw new Error("crash before the rename");
      return realOps.rename(from, to);
    },
    syncDir: (dir) => realOps.syncDir(dir),
  };
}

describe("a save interrupted at any step", () => {
  for (const step of ["writeTemp", "tornWrite", "rename"] as const) {
    it(`at ${step}: the change is refused and the ledger opens as it was before`, async () => {
      const dir = tempDir();
      const good = await openBackend(dir);
      await good.addTransaction(tx("Before"));
      const before = await good.load();

      const crashing = await openBackend(dir, failingAt(step));
      const r = await crashing.addTransaction(tx("During"));
      expect(r.ok ? "ok" : r.error.code).toBe("io");
      expect(await crashing.load()).toEqual(before);

      const reopened = await openBackend(dir);
      const after = await reopened.load();
      expect(after.status).toEqual({ kind: "ok" });
      expect(after).toEqual(before);
      // And the next save works over whatever the crash left behind.
      expect((await reopened.addTransaction(tx("After"))).ok).toBe(true);
      expect((await (await openBackend(dir)).load()).transactions.map((t) => t.payee)).toEqual(["After", "Before"]);
    });
  }

  it("a folder fsync that fails does not undo a save that is already in place", async () => {
    const dir = tempDir();
    const ops: SaveOps = { ...realOps, syncDir: async () => { throw new Error("EIO"); } };
    const service = await openBackend(dir, ops);
    expect((await service.addTransaction(tx("Kept"))).ok).toBe(true);
    expect((await (await openBackend(dir)).load()).transactions.map((t) => t.payee)).toEqual(["Kept"]);
  });

  it("a leftover temp file is never read", async () => {
    const dir = tempDir();
    await (await openBackend(dir)).addTransaction(tx("Real"));
    writeFileSync(join(dir, `${LEDGER_FILE}.tmp`), '{"version":1,"garbage');
    expect((await (await openBackend(dir)).load()).transactions.map((t) => t.payee)).toEqual(["Real"]);
  });

  it("a rename that Windows refuses for a moment is retried, and a lasting refusal is reported", async () => {
    let calls = 0;
    const busy = Object.assign(new Error("busy"), { code: "EPERM" });
    await renameWithRetry("a", "b", async () => {
      if (++calls < 3) throw busy;
    });
    expect(calls).toBe(3);
    await expect(renameWithRetry("a", "b", async () => { throw busy; }, 3)).rejects.toThrow("busy");
    const missing = Object.assign(new Error("gone"), { code: "ENOENT" });
    calls = 0;
    await expect(renameWithRetry("a", "b", async () => { calls++; throw missing; })).rejects.toThrow("gone");
    expect(calls).toBe(1);
  });
});

describe("files Tally must not write over", () => {
  const cases = [
    { name: "not JSON", content: '{"version": 1, "transactions": [', kind: "unreadable" },
    { name: "no version", content: '{"transactions": []}', kind: "unreadable" },
    { name: "wrong shape", content: '{"version": 1, "settings": {"currency": "USD"}, "transactions": "x", "categories": [], "nextId": 1}', kind: "unreadable" },
    { name: "a newer version", content: '{"version": 99, "anything": true}', kind: "newer" },
  ] as const;

  for (const c of cases) {
    it(`${c.name}: opens as ${c.kind}, refuses changes, and leaves the bytes alone`, async () => {
      const dir = tempDir();
      const file = join(dir, LEDGER_FILE);
      writeFileSync(file, c.content);
      const service = await openBackend(dir);
      const snap = await service.load();
      expect(snap.status.kind).toBe(c.kind);
      expect(snap.status.kind !== "ok" && snap.status.message).toContain(file);
      const r = await service.addTransaction(tx("Nope"));
      expect(r.ok ? "ok" : r.error.code).toBe("readonly");
      expect(readFileSync(file, "utf8")).toBe(c.content);
    });
  }
});

describe("file versions", () => {
  it("version 1 as slice 1 wrote it keeps opening", async () => {
    const dir = tempDir();
    copyFileSync(fixture("ledger-v1.json"), join(dir, LEDGER_FILE));
    const snap = await (await openBackend(dir)).load();
    expect(snap.status).toEqual({ kind: "ok" });
    expect(snap.settings).toEqual({ currency: "EUR" });
    expect(snap.transactions.map((t) => [t.id, t.date, t.payee, t.amount, t.note])).toEqual([
      ["t2", "2026-10-31", "Employer", 300000, "October"],
      ["t1", "2026-10-30", "Corner shop", -1250, ""],
    ]);
    expect(snap.rules).toEqual([]);
  });

  it("version 1 is written back as version 2 on the next change, keeping everything", async () => {
    const dir = tempDir();
    copyFileSync(fixture("ledger-v1.json"), join(dir, LEDGER_FILE));
    await (await openBackend(dir)).createCategory("Groceries");
    const doc = JSON.parse(readFileSync(join(dir, LEDGER_FILE), "utf8"));
    expect(doc.version).toBe(2);
    expect(doc.transactions).toHaveLength(2);
    expect(doc.categories).toEqual([{ id: "c3", name: "Groceries" }]);
    expect(doc.rules).toEqual([]);
  });

  it("a version 1 file that carries a category (the format allowed one) keeps it and its transactions' links", async () => {
    const dir = tempDir();
    const doc = JSON.parse(readFileSync(fixture("ledger-v1.json"), "utf8"));
    doc.categories = [{ id: "c3", name: "Pay" }];
    doc.transactions[1].categoryId = "c3";
    doc.nextId = 4;
    writeFileSync(join(dir, LEDGER_FILE), JSON.stringify(doc));
    const snap = await (await openBackend(dir)).load();
    expect(snap.categories).toEqual([{ id: "c3", name: "Pay" }]);
    expect(snap.transactions.find((t) => t.id === "t2")?.categoryId).toBe("c3");
  });

  it("version 2 as slice 3 wrote it keeps opening, categories and rules included", async () => {
    const dir = tempDir();
    copyFileSync(fixture("ledger-v2.json"), join(dir, LEDGER_FILE));
    const service = await openBackend(dir);
    const snap = await service.load();
    expect(snap.status).toEqual({ kind: "ok" });
    expect(snap.categories).toEqual([{ id: "c3", name: "Eating out" }, { id: "c2", name: "Groceries" }]);
    expect(snap.rules).toEqual([{ id: "r5", contains: "shop", categoryId: "c2" }]);
    expect(snap.transactions.map((t) => [t.id, t.categoryId])).toEqual([["t4", null], ["t1", "c2"]]);
    const r = await service.createCategory("Travel");
    expect(r.ok && r.value.categories.find((c) => c.name === "Travel")?.id).toBe("c6");
  });

  it("a byte order mark from a hand edit does not stop the file opening", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, LEDGER_FILE), "\uFEFF" + readFileSync(fixture("ledger-v1.json"), "utf8"));
    expect((await (await openBackend(dir)).load()).transactions).toHaveLength(2);
  });

  it("a nextId lower than an id in use never produces a duplicate id", async () => {
    const dir = tempDir();
    const doc = JSON.parse(readFileSync(fixture("ledger-v1.json"), "utf8"));
    writeFileSync(join(dir, LEDGER_FILE), JSON.stringify({ ...doc, nextId: 1 }));
    const r = await (await openBackend(dir)).addTransaction(tx("New"));
    expect(r.ok && r.value.transactions.map((t) => t.id).sort()).toEqual(["t1", "t2", "t3"]);
  });
});
