// L6: export and undo in the real app. TALLY_SAVE_PATH names the file the
// save dialog would return and TALLY_OPEN_PATH the one the open dialog would
// (electron/dialogs.ts); writing, reading, importing and saving are the
// shipped code paths in the main process.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot } from "../../contracts/tally";
import { launch, removeDir, tempDataDir, type Launched } from "./launch";

const fixture = (name: string) => join(process.cwd(), "tests", "fixtures", "csv", name);
const nav = (win: Page, name: string) => win.getByRole("navigation").getByRole("button", { name, exact: true }).click();

async function importChosen(win: Page, rows: number): Promise<void> {
  await nav(win, "Import");
  await win.getByRole("button", { name: "Choose a CSV file…" }).click();
  await win.getByRole("button", { name: `Import ${rows} transactions` }).click();
  await expect(win.locator(".import-result")).toContainText(`Imported ${rows} transactions`);
}

/** The transactions as the person sees them, category by name; ids may differ between ledgers. */
async function portable(win: Page): Promise<string[][]> {
  const snap: Snapshot = await win.evaluate(() => window.tallyBridge!.load());
  const name = (id: string | null) => snap.categories.find((c) => c.id === id)?.name ?? "";
  return snap.transactions.map((t) => [t.date, t.payee, String(t.amount), name(t.categoryId), t.note]);
}

const sourceDir = tempDataDir();
const targetDir = tempDataDir();
const exported = join(tempDataDir(), "export.csv");
let s: Launched;

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await s?.app.close();
  for (const d of [sourceDir, targetDir]) removeDir(d);
});

test("exports the filtered transactions through the save dialog's path", async () => {
  s = await launch(sourceDir, { TALLY_OPEN_PATH: fixture("bank-comma.csv"), TALLY_SAVE_PATH: exported });
  await nav(s.win, "Categories");
  await s.win.getByLabel("New category").fill("Groceries");
  await s.win.getByRole("button", { name: "Create" }).click();
  await s.win.getByLabel("Payee contains").fill("corner");
  await s.win.getByRole("button", { name: "Add rule" }).click();
  await importChosen(s.win, 6);
  await nav(s.win, "Transactions");
  await s.win.getByLabel("Search").fill("o");
  await expect(s.win.getByTestId("shown")).toHaveText("Showing 5 of 6");
  await s.win.getByRole("button", { name: "Export shown to CSV" }).click();
  await expect(s.win.locator(".export-message")).toHaveText(`Exported 5 transactions to ${exported}.`);
  const bytes = readFileSync(exported);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.toString("utf8").split("\r\n")[0]).toBe("\uFEFFDate,Payee,Amount,Category,Note");
});

test("the export imports into a fresh ledger as the same transactions", async () => {
  const before = (await portable(s.win)).filter((r) => r[1].includes("o"));
  await s.app.close();
  s = await launch(targetDir, { TALLY_OPEN_PATH: exported });
  await importChosen(s.win, 5);
  expect(await portable(s.win)).toEqual(before);
});

test("undo takes the import back out, and the ledger file agrees after a restart", async () => {
  await s.win.getByTestId("undo-bar").getByRole("button", { name: "Undo" }).click();
  await expect(s.win.getByTestId("undo-bar")).toHaveCount(0);
  await nav(s.win, "Transactions");
  await expect(s.win.getByTestId("count")).toHaveText("0 transactions");
  await s.app.close();
  s = await launch(targetDir);
  await expect(s.win.getByTestId("count")).toHaveText("0 transactions");
  // Undo lives in memory only: nothing is offered after a restart.
  await expect(s.win.getByTestId("undo-bar")).toHaveCount(0);
  expect(s.errors).toEqual([]);
});
