// L3: export through the main process's own file code. The CSV written to
// disk (with a byte order mark for spreadsheet apps) reads back through the
// import path and becomes the same transactions in an empty ledger file.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Snapshot } from "../../contracts/tally";
import { inspectCsv } from "../../core/csv-inspect";
import { exportCsv } from "../../core/csv-export";
import { openBackend } from "../../electron/backend";
import { readCsvFile, writeCsvFile } from "../../electron/files";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "tally-export-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const portable = (s: Snapshot) => {
  const name = (id: string | null) => s.categories.find((c) => c.id === id)?.name ?? "";
  return s.transactions.map((t) => [t.date, t.payee, t.amount, name(t.categoryId), t.note]);
};

describe("export to a file and import it back", () => {
  it("gives the same transactions in an empty ledger file", async () => {
    const source = await openBackend(tempDir());
    await source.createCategory("Groceries");
    await source.addTransaction({ date: "2026-11-02", payee: "Corner shop", amount: -1250, categoryId: "c1", note: "milk, eggs" });
    await source.addTransaction({ date: "2026-11-02", payee: 'The "Big" Market', amount: -4999, categoryId: "c1", note: "" });
    await source.addTransaction({ date: "2026-11-01", payee: "Employer", amount: 320000, categoryId: null, note: "line one\nline two" });
    const before = await source.load();

    const file = join(tempDir(), "tally-export.csv");
    const written = await writeCsvFile(file, exportCsv(before.transactions, before.categories, before.settings.currency));
    expect(written).toEqual({ ok: true, value: file });
    expect([...readFileSync(file).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const picked = await readCsvFile(file);
    if (!picked.ok) throw new Error(picked.error.message);
    const target = await openBackend(tempDir());
    const r = await target.importCsv(picked.value.text, inspectCsv(picked.value.text).mapping);
    expect(r.ok && [r.value.added, r.value.rejected]).toEqual([3, 0]);
    expect(portable(r.ok ? r.value.snapshot : before)).toEqual(portable(before));
  });

  it("reports a file it cannot write", async () => {
    const r = await writeCsvFile(join(tempDir(), "no-such-folder", "x.csv"), "a,b\r\n");
    expect(r.ok ? "ok" : r.error.code).toBe("io");
  });
});
