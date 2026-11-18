// L2: the labelled mock and the real backend answer the same calls the same
// way. The real backend is opened exactly as the main process opens it
// (electron/backend.ts, the ledger file in a temp folder) and is reopened from
// disk after every step, so a field the file drops or a value it changes shows
// up here as a difference from the mock.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ImportMapping, LedgerApi } from "../../contracts/tally";
import { openBackend } from "../../electron/backend";
import { createMock } from "../../src/mock";

type Step = { name: string; call: (api: LedgerApi) => Promise<unknown> };

const tx = (date: string, payee: string, amount: number, note = "") => ({ date, payee, amount, categoryId: null, note });

const CSV = [
  "Date;Payee;Amount",
  "01.10.2026;Employer;3.200,00",
  "02.10.2026;\"Corner; shop\";-12,50",
  "02.10.2026;\"Corner; shop\";-12,50",
  "03.10.2026;Bakery;oops",
].join("\r\n");
const MAPPING: ImportMapping = { delimiter: ";", headerRow: 0, date: 0, payee: 1, amount: { kind: "signed", column: 2 }, dateOrder: "DMY", decimal: "," };

const steps: Step[] = [
  { name: "load an empty ledger", call: (api) => api.load() },
  { name: "add a spending", call: (api) => api.addTransaction(tx("2026-11-02", "Corner shop", -1250, "milk")) },
  { name: "add an income", call: (api) => api.addTransaction(tx("2026-11-01", "Employer", 250000)) },
  { name: "add on the same date", call: (api) => api.addTransaction(tx("2026-11-02", "Bakery", -480)) },
  { name: "edit a transaction", call: (api) => api.updateTransaction("t1", tx("2026-11-03", "Corner shop", -1350, "milk, eggs")) },
  { name: "refuse an invalid add", call: (api) => api.addTransaction(tx("2026-11-31", "Nowhere", -1)) },
  { name: "refuse an edit of an unknown id", call: (api) => api.updateTransaction("t99", tx("2026-11-03", "x", -1)) },
  { name: "delete a transaction", call: (api) => api.deleteTransaction("t3") },
  { name: "refuse deleting it twice", call: (api) => api.deleteTransaction("t3") },
  { name: "change to a currency with the same digits", call: (api) => api.setCurrency("EUR") },
  { name: "refuse a currency with other digits", call: (api) => api.setCurrency("JPY") },
  { name: "import a bank CSV", call: (api) => api.importCsv(CSV, MAPPING) },
  { name: "import the same file again: nothing added", call: (api) => api.importCsv(CSV, MAPPING) },
  { name: "refuse an import with a broken mapping", call: (api) => api.importCsv(CSV, { ...MAPPING, delimiter: "x" as ";" }) },
  { name: "import debit and credit columns", call: (api) => api.importCsv("d,p,out,in\n2026-10-09,Shop,5.00,\n2026-10-09,Refund,,5.00", { ...MAPPING, delimiter: ",", amount: { kind: "split", debit: 2, credit: 3 }, decimal: "." }) },
  { name: "load again", call: (api) => api.load() },
];

/** The file path is the one thing that is meant to differ. */
function comparable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (key, v: unknown) => (key === "file" ? "-" : v));
}

describe("contract: mock and real backend", () => {
  const dir = mkdtempSync(join(tmpdir(), "tally-contract-"));
  const mock = createMock();
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("answer every call of the script identically, and the file keeps every answer", async () => {
    let real = await openBackend(dir);
    for (const step of steps) {
      const fromMock = comparable(await step.call(mock));
      const fromReal = comparable(await step.call(real));
      expect(fromReal, step.name).toEqual(fromMock);
      // Reopen from disk: what the file holds must be what the mock holds.
      real = await openBackend(dir);
      expect(comparable(await real.load()), `${step.name}, after reopening`).toEqual(comparable(await mock.load()));
    }
  });

  it("the real backend names the ledger file; the mock says it is memory", async () => {
    expect((await (await openBackend(dir)).load()).file).toBe(join(dir, "ledger.json"));
    expect((await mock.load()).file).toBe("memory");
    expect(mock.kind).toBe("mock");
  });
});
