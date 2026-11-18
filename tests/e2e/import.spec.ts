// L6: importing a bank CSV in the real app. The open dialog is the one thing
// a test cannot drive, so TALLY_OPEN_PATH names the file it would return
// (electron/dialogs.ts); reading, decoding, planning and saving are the
// shipped code paths in the main process.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, removeDir, tempDataDir, type Launched } from "./launch";

const fixture = (name: string) => join(process.cwd(), "tests", "fixtures", "csv", name);

async function chooseFile(win: Page): Promise<void> {
  await win.getByRole("button", { name: "Import" }).click();
  await win.getByRole("button", { name: "Choose a CSV file…" }).click();
}

const dir = tempDataDir();
let s: Launched;

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await s?.app.close();
  removeDir(dir);
});

test("imports a semicolon file with debit and credit columns through the main process", async () => {
  s = await launch(dir, { TALLY_OPEN_PATH: fixture("bank-semicolon.csv") });
  await chooseFile(s.win);
  await expect(s.win.getByTestId("import-summary")).toHaveText("4 rows will be imported · 0 already in the ledger · 2 cannot be read");
  const main = await s.app.evaluate(() => ({ os: process.platform, arch: process.arch }));
  mkdirSync(join(process.cwd(), "artifacts", "e2e"), { recursive: true });
  await s.win.screenshot({ path: join(process.cwd(), "artifacts", "e2e", `import-${main.os}-${main.arch}.png`) });
  await s.win.getByRole("button", { name: "Import 4 transactions" }).click();
  await expect(s.win.getByRole("status")).toContainText("Imported 4 transactions from bank-semicolon.csv.");
  const doc = JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8"));
  expect(doc.transactions.map((t: { payee: string; amount: number }) => [t.payee, t.amount])).toEqual([
    ["Employer GmbH", 320000], ["Bakery; Miller", -480], ["City power", -6420], ["Refund shop", 1200],
  ]);
});

test("the same file a second time adds nothing", async () => {
  await chooseFile(s.win);
  await expect(s.win.getByTestId("import-summary")).toHaveText("0 rows will be imported · 4 already in the ledger · 2 cannot be read");
  await expect(s.win.getByRole("button", { name: "Import 0 transactions" })).toBeDisabled();
});

test("the imported transactions are there after a restart", async () => {
  await s.app.close();
  s = await launch(dir);
  await expect(s.win.getByTestId("count")).toHaveText("4 transactions");
  expect(s.errors).toEqual([]);
});

test("a 2,000-row statement imports in under five seconds, end to end", async () => {
  const other = tempDataDir();
  const lines = ["Date,Description,Amount"];
  for (let i = 0; i < 2000; i++) lines.push(`2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")},"Payee ${i}",-${(i % 500) + 1}.${String(i % 100).padStart(2, "0")}`);
  const file = join(other, "statement.csv");
  writeFileSync(file, lines.join("\n"));
  const t = await launch(other, { TALLY_OPEN_PATH: file });
  try {
    // Timed from choosing the file: reading, detecting, previewing, importing, saving and listing.
    const started = Date.now();
    await chooseFile(t.win);
    await expect(t.win.getByTestId("import-summary")).toHaveText("2000 rows will be imported · 0 already in the ledger · 0 cannot be read");
    await t.win.getByRole("button", { name: "Import 2000 transactions" }).click();
    await expect(t.win.getByRole("status")).toContainText("Imported 2000 transactions");
    await t.win.getByRole("button", { name: "Transactions", exact: true }).click();
    await expect(t.win.getByTestId("count")).toHaveText("2000 transactions");
    expect(Date.now() - started).toBeLessThan(5000);
  } finally {
    await t.app.close();
    removeDir(other);
  }
});
