// L4 and L5 for finding, exporting and undoing, against the labelled mock.
// Seeded by importing months.csv with two categories and their rules.
import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertGeometry, captureGeometry } from "./geometry";

const platform = process.platform;
const csv = (name: string) => join(import.meta.dirname, "..", "fixtures", "csv", name);
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
const rows = (page: Page) => page.getByRole("table", { name: "Transactions" }).locator("tbody tr");
const payees = (page: Page) => rows(page).locator("td.payee").allTextContents();

async function importFile(page: Page, file: string, rowsToImport: number): Promise<void> {
  await nav(page, "Import");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Choose (a|another) CSV file/ }).click();
  await (await chooser).setFiles(file);
  await page.getByRole("button", { name: `Import ${rowsToImport} transactions` }).click();
  await expect(page.locator(".import-result")).toContainText(`Imported ${rowsToImport} transactions`);
}

async function seed(page: Page): Promise<void> {
  await nav(page, "Categories");
  for (const name of ["Groceries", "Eating out"]) {
    await page.getByLabel("New category").fill(name);
    await page.getByRole("button", { name: "Create" }).click();
  }
  for (const [text, category] of [["market", "Groceries"], ["pizza", "Eating out"]]) {
    await page.getByLabel("Payee contains").fill(text);
    await page.getByLabel("Use category").selectOption({ label: category });
    await page.getByRole("button", { name: "Add rule" }).click();
  }
  await importFile(page, csv("months.csv"), 7);
  await nav(page, "Transactions");
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-18T10:00:00"));
  await page.goto("/");
  await expect(page.getByTestId("backend-badge")).toHaveText("mock");
});

test("searches payee and note text, and filters by category, dates and amounts", async ({ page }) => {
  await seed(page);
  await expect(page.getByTestId("shown")).toHaveText("Showing all 7");
  await page.getByLabel("Search").fill("MARKET");
  expect(await payees(page)).toEqual(["Market Hall refund", "Market Hall", "Market Hall"]);
  await expect(page.getByTestId("shown")).toHaveText("Showing 3 of 7");
  await page.getByLabel("Search").fill("");
  await page.getByLabel("In", { exact: true }).selectOption({ label: "Eating out" });
  expect(await payees(page)).toEqual(["Pizza Roma"]);
  await page.getByLabel("In", { exact: true }).selectOption({ label: "Uncategorised" });
  expect(await payees(page)).toEqual(["Train", "Kiosk", "Employer"]);
  await page.getByLabel("In", { exact: true }).selectOption({ label: "Any category" });
  await page.getByLabel("From").fill("2026-11-01");
  await page.getByLabel("To", { exact: true }).fill("2026-11-30");
  await expect(page.getByTestId("shown")).toHaveText("Showing 5 of 7");
  await page.getByLabel("At least").fill("15");
  await page.getByLabel("At most").fill("125");
  expect(await payees(page)).toEqual(["Pizza Roma", "Market Hall refund", "Market Hall"]);
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByTestId("shown")).toHaveText("Showing all 7");
});

test("says what in the filter it cannot read", async ({ page }) => {
  await seed(page);
  await page.getByLabel("At least").fill("lots");
  await expect(page.getByRole("search").locator("xpath=following-sibling::div").getByRole("alert")).toHaveText('At least: Amount "lots" is not a number.');
});

test("exports exactly the transactions shown, as a CSV that imports back as the same transactions", async ({ page }, testInfo) => {
  await seed(page);
  await page.getByLabel("Search").fill("market");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export shown to CSV" }).click();
  const file = testInfo.outputPath("export.csv");
  await (await download).saveAs(file);
  expect((await download).suggestedFilename()).toBe("tally-2026-11-18.csv");
  expect(readFileSync(file, "utf8")).toBe([
    "\uFEFFDate,Payee,Amount,Category,Note",
    "2026-10-31,Market Hall,-50.00,Groceries,",
    "2026-11-01,Market Hall,-120.00,Groceries,",
    "2026-11-15,Market Hall refund,15.00,Groceries,",
    "",
  ].join("\r\n"));
  await expect(page.locator(".export-message")).toHaveText("Exported 3 transactions to tally-2026-11-18.csv.");

  // A fresh, empty ledger: the export imports as the same three transactions, categories included.
  const before = await rows(page).evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].slice(0, 5).map((td) => td.textContent)));
  await page.reload();
  await importFile(page, file, 3);
  await nav(page, "Transactions");
  const after = await rows(page).evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].slice(0, 5).map((td) => td.textContent)));
  expect(after).toEqual(before);
});

test("undoes a delete once, and the undo bar goes away", async ({ page }) => {
  await seed(page);
  const kiosk = rows(page).filter({ hasText: "Kiosk" });
  await kiosk.getByRole("button", { name: "Delete" }).click();
  await kiosk.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByTestId("undo-bar")).toContainText('Deleted the transaction "Kiosk" of 2026-11-21.');
  await page.getByTestId("undo-bar").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Undone" })).toHaveText('Undone: Deleted the transaction "Kiosk" of 2026-11-21.');
  await expect(rows(page).filter({ hasText: "Kiosk" })).toHaveCount(1);
  await expect(page.getByTestId("undo-bar")).toHaveCount(0);
});

test("undoes a category merge and an import; any other change forgets the undo", async ({ page }) => {
  await seed(page);
  await nav(page, "Categories");
  await page.getByRole("combobox", { name: /^Merge/ }).selectOption({ label: "Eating out" });
  await page.getByRole("combobox", { name: /^into/ }).selectOption({ label: "Groceries" });
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await page.getByTestId("undo-bar").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("table", { name: "Categories" }).locator("td.name")).toHaveText(["Eating out", "Groceries"]);

  await importFile(page, csv("bank-comma.csv"), 6);
  await expect(page.getByTestId("undo-bar")).toContainText("Imported 6 transactions.");
  await page.getByTestId("undo-bar").getByRole("button", { name: "Undo" }).click();
  await nav(page, "Transactions");
  await expect(page.getByTestId("count")).toHaveText("7 transactions");

  const kiosk = rows(page).filter({ hasText: "Kiosk" });
  await kiosk.getByRole("button", { name: "Delete" }).click();
  await kiosk.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByTestId("undo-bar")).toBeVisible();
  await page.getByLabel("Payee").fill("Something new");
  await page.getByLabel("Amount").fill("1");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("undo-bar")).toHaveCount(0);
});

async function sample(page: Page): Promise<void> {
  await seed(page);
  await page.getByLabel("Search").fill("market");
  await page.getByLabel("Search").blur();
}

test("tier 1: accessibility structure is identical everywhere", async ({ page }) => {
  await sample(page);
  await expect(page.locator("main")).toMatchAriaSnapshot({ name: "find.aria.yml" });
});

test("tier 2: layout geometry stays within tolerance everywhere", async ({ page }) => {
  await sample(page);
  assertGeometry(join(test.info().project.testDir, "__snapshots__", "find.spec.ts", "find.geometry.json"), await captureGeometry(page));
});

test("tier 3: pixels match the per-OS baseline", async ({ page }, testInfo) => {
  const name = `find-${testInfo.project.name}-${platform}.png`;
  const baseline = join(testInfo.project.testDir, "__snapshots__", "find.spec.ts", name);
  test.skip(!process.env.CI && !existsSync(baseline), "no local pixel baseline; the snapshots workflow captures them on the runners");
  await sample(page);
  await expect(page).toHaveScreenshot(name, { fullPage: true });
});
