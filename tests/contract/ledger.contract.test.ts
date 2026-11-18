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

/** `want`: the outcome both must give, so a step cannot pass by both refusing it. */
type Step = { name: string; want?: "ok" | "invalid" | "not_found"; call: (api: LedgerApi) => Promise<unknown> };

function outcome(value: unknown): string {
  if (typeof value !== "object" || value === null || !("ok" in value)) return "-";
  const r = value as { ok: boolean; error?: { code: string } };
  return r.ok ? "ok" : (r.error?.code ?? "?");
}

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
  { name: "add a spending", want: "ok", call: (api) => api.addTransaction(tx("2026-11-02", "Corner shop", -1250, "milk")) },
  { name: "add an income", want: "ok", call: (api) => api.addTransaction(tx("2026-11-01", "Employer", 250000)) },
  { name: "add on the same date", want: "ok", call: (api) => api.addTransaction(tx("2026-11-02", "Bakery", -480)) },
  { name: "edit a transaction", want: "ok", call: (api) => api.updateTransaction("t1", tx("2026-11-03", "Corner shop", -1350, "milk, eggs")) },
  { name: "refuse an invalid add", want: "invalid", call: (api) => api.addTransaction(tx("2026-11-31", "Nowhere", -1)) },
  { name: "refuse an edit of an unknown id", want: "not_found", call: (api) => api.updateTransaction("t99", tx("2026-11-03", "x", -1)) },
  { name: "delete a transaction", want: "ok", call: (api) => api.deleteTransaction("t3") },
  { name: "refuse deleting it twice", want: "not_found", call: (api) => api.deleteTransaction("t3") },
  { name: "change to a currency with the same digits", want: "ok", call: (api) => api.setCurrency("EUR") },
  { name: "refuse a currency with other digits", want: "invalid", call: (api) => api.setCurrency("JPY") },
  { name: "import a bank CSV", want: "ok", call: (api) => api.importCsv(CSV, MAPPING) },
  { name: "import the same file again: nothing added", want: "ok", call: (api) => api.importCsv(CSV, MAPPING) },
  { name: "refuse an import with a broken mapping", want: "invalid", call: (api) => api.importCsv(CSV, { ...MAPPING, delimiter: "x" as ";" }) },
  { name: "import debit and credit columns", want: "ok", call: (api) => api.importCsv("d,p,out,in\n2026-10-09,Shop,5.00,\n2026-10-09,Refund,,5.00", { ...MAPPING, delimiter: ",", amount: { kind: "split", debit: 2, credit: 3 }, decimal: "." }) },
  { name: "create a category", want: "ok", call: (api) => api.createCategory("Groceries") },
  { name: "create another", want: "ok", call: (api) => api.createCategory("Eating out") },
  { name: "refuse a name already taken", want: "invalid", call: (api) => api.createCategory("groceries") },
  { name: "rename a category", want: "ok", call: (api) => api.renameCategory("c9", "Food") },
  { name: "create a rule", want: "ok", call: (api) => api.createRule("corner", "c9") },
  { name: "apply the rules to uncategorised transactions", want: "ok", call: (api) => api.applyRules() },
  { name: "create a second rule", want: "ok", call: (api) => api.createRule("shop", "c10") },
  { name: "merge one category into the other", want: "ok", call: (api) => api.mergeCategories("c10", "c9") },
  { name: "delete a rule", want: "ok", call: (api) => api.deleteRule("r11") },
  { name: "delete a category", want: "ok", call: (api) => api.deleteCategory("c9") },
  { name: "create a category and a rule for an import", call: async (api) => [await api.createCategory("Pay"), await api.createRule("employer", "c13")] },
  { name: "import rows the rules categorise", want: "ok", call: (api) => api.importCsv("Date;Payee;Amount\r\n01.11.2026;Employer;3.200,00", MAPPING) },
  { name: "set a monthly budget", want: "ok", call: (api) => api.setBudget("c13", 250000) },
  { name: "refuse a budget that is not a positive whole number", want: "invalid", call: (api) => api.setBudget("c13", -5) },
  { name: "refuse a budget for an unknown category", want: "not_found", call: (api) => api.setBudget("c99", 100) },
  { name: "merging keeps the target's own budget", want: "ok", call: async (api) => {
    await api.createCategory("Wages");
    await api.setBudget("c16", 1000);
    return api.mergeCategories("c16", "c13");
  } },
  { name: "remove a budget", want: "ok", call: (api) => api.setBudget("c13", null) },
  { name: "nothing to undo after a budget change", want: "not_found", call: (api) => api.undo() },
  { name: "delete a transaction to undo", want: "ok", call: (api) => api.deleteTransaction("t4") },
  { name: "undo the delete", want: "ok", call: (api) => api.undo() },
  { name: "undo only once", want: "not_found", call: (api) => api.undo() },
  { name: "merge, then undo the merge", want: "ok", call: async (api) => {
    await api.createCategory("Snacks");
    await api.mergeCategories("c17", "c13");
    return api.undo();
  } },
  { name: "import with category and note columns, creating a category", want: "ok", call: (api) =>
    api.importCsv("Date,Payee,Amount,Category,Note\r\n2026-11-03,Florist,-20.00,Gifts,\"for Sam, Friday\"\r\n2026-11-04,Baker,-3.00,snacks,", { ...MAPPING, delimiter: ",", decimal: ".", dateOrder: "YMD", category: 3, note: 4 }) },
  { name: "undo the import", want: "ok", call: (api) => api.undo() },
  { name: "any other change forgets what could be undone", want: "not_found", call: async (api) => {
    await api.deleteTransaction("t5");
    await api.createCategory("Later");
    return api.undo();
  } },
  { name: "load again", call: (api) => api.load() },
];

/** The file path is the one thing that is meant to differ. */
function comparable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (key, v: unknown) => (key === "file" ? "-" : v));
}

/** What a fresh open of the file must show: everything but undo, which lives in memory only. */
function onDisk(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (key, v: unknown) => (key === "file" || key === "undo" ? "-" : v));
}

describe("contract: mock and real backend", () => {
  const dir = mkdtempSync(join(tmpdir(), "tally-contract-"));
  const mock = createMock();
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("answer every call of the script identically, and the file keeps every answer", async () => {
    const real = await openBackend(dir);
    for (const step of steps) {
      const fromMock = comparable(await step.call(mock));
      const fromReal = comparable(await step.call(real));
      expect(fromReal, step.name).toEqual(fromMock);
      if (step.want) expect(outcome(fromReal), step.name).toBe(step.want);
      // A second, fresh open of the file: what the file holds must be what the mock holds.
      const reopened = await openBackend(dir);
      expect(onDisk(await reopened.load()), `${step.name}, after reopening`).toEqual(onDisk(await mock.load()));
    }
  });

  it("the real backend names the ledger file; the mock says it is memory", async () => {
    expect((await (await openBackend(dir)).load()).file).toBe(join(dir, "ledger.json"));
    expect((await mock.load()).file).toBe("memory");
    expect(mock.kind).toBe("mock");
  });
});
