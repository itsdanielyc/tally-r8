// L3: importing through the real backend and the ledger file. A 2,000-row
// bank CSV imports in well under five seconds, read from disk and decoded the
// way the main process does it; a save that fails leaves no row behind.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ImportMapping } from "../../contracts/tally";
import { openBackend } from "../../electron/backend";
import { decodeCsv, readCsvFile } from "../../electron/files";
import { realOps } from "../../electron/store";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "tally-import-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const MAPPING: ImportMapping = { delimiter: ";", headerRow: 0, date: 0, payee: 1, amount: { kind: "split", debit: 2, credit: 3 }, dateOrder: "DMY", decimal: "," };

/** A 2,000-row statement in the shape the risks in PRODUCT.md describe. */
function statement(rows: number): string {
  const lines = ["Booking date;Payee;Debit;Credit;Note"];
  for (let i = 0; i < rows; i++) {
    const day = String((i % 28) + 1).padStart(2, "0");
    const month = String((Math.floor(i / 28) % 12) + 1).padStart(2, "0");
    const cents = 100 + ((i * 7919) % 99_900);
    const amount = `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
    const payee = i % 10 === 0 ? `"Shop ${i}; branch"` : `Payee ${i}`;
    lines.push(i % 5 === 0 ? `${day}.${month}.2026;${payee};;${amount};` : `${day}.${month}.2026;${payee};${amount};;row ${i}`);
  }
  return lines.join("\r\n") + "\r\n";
}

describe("a 2,000-row bank CSV", () => {
  it("is read from disk and imported into the ledger file in under five seconds", async () => {
    const dir = tempDir();
    const file = join(dir, "statement.csv");
    writeFileSync(file, "\uFEFF" + statement(2000), "utf8");
    const service = await openBackend(dir);

    const started = performance.now();
    const picked = await readCsvFile(file);
    if (!picked.ok) throw new Error(picked.error.message);
    const r = await service.importCsv(picked.value.text, MAPPING);
    const elapsed = performance.now() - started;

    expect(r.ok && [r.value.added, r.value.duplicates, r.value.rejected]).toEqual([2000, 0, 0]);
    expect(elapsed).toBeLessThan(5000);
    const reopened = await (await openBackend(dir)).load();
    expect(reopened.transactions).toHaveLength(2000);
    expect(reopened.transactions.find((t) => t.payee === "Shop 10; branch")).toMatchObject({ date: "2026-01-11", amount: 79290 });
  });

  it("imported a second time adds nothing, and says so", async () => {
    const dir = tempDir();
    const service = await openBackend(dir);
    await service.importCsv(statement(2000), MAPPING);
    const again = await service.importCsv(statement(2000), MAPPING);
    expect(again.ok && [again.value.added, again.value.duplicates]).toEqual([0, 2000]);
    expect((await (await openBackend(dir)).load()).transactions).toHaveLength(2000);
  });
});

describe("all or none, on disk", () => {
  it("a save that fails during an import leaves the ledger file without any of its rows", async () => {
    const dir = tempDir();
    const good = await openBackend(dir);
    await good.addTransaction({ date: "2026-01-01", payee: "Before", amount: -100, categoryId: null, note: "" });
    const failing = await openBackend(dir, { ...realOps, rename: async () => { throw new Error("crash before the rename"); } });
    const r = await failing.importCsv(statement(50), MAPPING);
    expect(r.ok ? "ok" : r.error.code).toBe("io");
    expect((await (await openBackend(dir)).load()).transactions.map((t) => t.payee)).toEqual(["Before"]);
  });
});

describe("reading a CSV file", () => {
  it("decodes UTF-8 with or without a byte order mark", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.csv"), Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("Café;1", "utf8")]));
    const r = await readCsvFile(join(dir, "a.csv"));
    expect(r.ok && r.value).toEqual({ name: "a.csv", text: "Café;1" });
  });

  it("falls back to Windows-1252 for bytes that are not UTF-8", () => {
    expect(decodeCsv(Uint8Array.from([0x43, 0x61, 0x66, 0xe9, 0x3b, 0x80]))).toBe("Café;€");
  });

  it("refuses a file over 10 MB and reports a file it cannot read", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "big.csv"), Buffer.alloc(10 * 1024 * 1024 + 1, 0x41));
    const big = await readCsvFile(join(dir, "big.csv"));
    expect(big.ok ? "ok" : big.error.message).toContain("larger than 10 MB");
    const missing = await readCsvFile(join(dir, "missing.csv"));
    expect(missing.ok ? "ok" : missing.error.code).toBe("io");
  });
});
