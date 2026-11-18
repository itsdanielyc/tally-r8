// L4 and L5 for categories and payee rules, against the labelled mock:
// create, rename, delete, merge; assign a category in the entry form; rules
// on import and on request.
import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertGeometry, captureGeometry } from "./geometry";

const platform = process.platform;
const csv = (name: string) => join(import.meta.dirname, "..", "fixtures", "csv", name);

const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
const categoryRows = (page: Page) => page.getByRole("table", { name: "Categories" }).locator("tbody tr");
const categoryRow = (page: Page, name: string) => categoryRows(page).filter({ has: page.getByRole("cell", { name, exact: true }) });

async function createCategory(page: Page, name: string): Promise<void> {
  await page.getByLabel("New category").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(categoryRow(page, name.trim())).toHaveCount(1);
}

async function addTransaction(page: Page, payee: string, category?: string): Promise<void> {
  await nav(page, "Transactions");
  await page.getByLabel("Date").fill("2026-11-02");
  await page.getByLabel("Amount").fill("10");
  await page.getByLabel("Payee").fill(payee);
  if (category) await page.getByLabel("Category").selectOption({ label: category });
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.locator("tbody tr").filter({ hasText: payee })).toHaveCount(1);
}

const categoryOf = (page: Page, payee: string) =>
  page.getByRole("table", { name: "Transactions" }).locator("tbody tr").filter({ hasText: payee }).locator("td.category");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-18T10:00:00"));
  await page.goto("/");
  await expect(page.getByTestId("backend-badge")).toHaveText("mock");
  await nav(page, "Categories");
});

test("creates categories, lists them by name, and refuses a name already taken", async ({ page }) => {
  await expect(page.getByText("No categories yet. Create the first one above.")).toBeVisible();
  await createCategory(page, "Groceries");
  await createCategory(page, "  bills ");
  await expect(categoryRows(page).locator("td.name")).toHaveText(["bills", "Groceries"]);
  await page.getByLabel("New category").fill("GROCERIES");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("form", { name: "Create a category" }).getByRole("alert")).toHaveText('There is already a category called "GROCERIES".');
  await expect(categoryRows(page)).toHaveCount(2);
});

test("renames in the row, and Escape cancels", async ({ page }) => {
  await createCategory(page, "Grocery");
  await categoryRow(page, "Grocery").getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("New name for Grocery").fill("Groceries");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(categoryRows(page).locator("td.name")).toHaveText(["Groceries"]);
  await categoryRow(page, "Groceries").getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("New name for Groceries").fill("Not this");
  await page.keyboard.press("Escape");
  await expect(categoryRows(page).locator("td.name")).toHaveText(["Groceries"]);
});

// Bug hunt L7: after a refused rename, a successful one used to leave the editor coming back.
test("after a refused rename, a good one closes the editor for good", async ({ page }) => {
  await createCategory(page, "Bills");
  await createCategory(page, "Grocery");
  await categoryRow(page, "Grocery").getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("New name for Grocery").fill("bills");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("form.rename").getByRole("alert")).toHaveText('There is already a category called "bills".');
  await page.getByLabel("New name for Grocery").fill("Groceries");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(categoryRows(page).locator("td.name")).toHaveText(["Bills", "Groceries"]);
  await createCategory(page, "Travel");
  await expect(page.locator("form.rename")).toHaveCount(0);
});

test("a category picked in the entry form shows in the list; deleting it leaves the transaction uncategorised", async ({ page }) => {
  await createCategory(page, "Groceries");
  await addTransaction(page, "Corner shop", "Groceries");
  await expect(categoryOf(page, "Corner shop")).toHaveText("Groceries");

  await nav(page, "Categories");
  await expect(categoryRow(page, "Groceries").locator("td.amount")).toHaveText("1");
  await categoryRow(page, "Groceries").getByRole("button", { name: "Delete" }).click();
  await categoryRow(page, "Groceries").getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByRole("status")).toHaveText("Deleted Groceries; 1 transaction is now uncategorised.");
  await nav(page, "Transactions");
  await expect(categoryOf(page, "Corner shop")).toHaveText("Uncategorised");
});

test("merging moves every transaction to the second category and removes the first", async ({ page }) => {
  await createCategory(page, "Cafes");
  await createCategory(page, "Eating out");
  await addTransaction(page, "Cafe Luna", "Cafes");
  await addTransaction(page, "Pizza place", "Eating out");
  await nav(page, "Categories");
  await page.getByRole("combobox", { name: /^Merge/ }).selectOption({ label: "Cafes" });
  await page.getByRole("combobox", { name: /^into/ }).selectOption({ label: "Eating out" });
  await page.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Merged Cafes into Eating out.");
  await expect(categoryRows(page).locator("td.name")).toHaveText(["Eating out"]);
  await expect(categoryRow(page, "Eating out").locator("td.amount")).toHaveText("2");
  await nav(page, "Transactions");
  await expect(categoryOf(page, "Cafe Luna")).toHaveText("Eating out");
});

test("a rule categorises imported rows, shown in the preview and kept on import", async ({ page }) => {
  await createCategory(page, "Groceries");
  await page.getByLabel("Payee contains").fill("corner");
  await page.getByLabel("Use category").selectOption({ label: "Groceries" });
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByRole("table", { name: "Rules" }).locator("tbody tr")).toHaveText([/"corner"\s*Groceries/]);

  await nav(page, "Import");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose a CSV file…" }).click();
  await (await chooser).setFiles(csv("bank-comma.csv"));
  await expect(page.getByRole("table", { name: "Preview" }).locator("tbody tr").filter({ hasText: "Corner shop" }).first().locator("td.category")).toHaveText("Groceries");
  await page.getByRole("button", { name: "Import 6 transactions" }).click();
  await nav(page, "Transactions");
  await expect(page.locator("tbody tr td.category").filter({ hasText: "Groceries" })).toHaveCount(3);
});

test("on request, rules categorise every uncategorised transaction and say how many", async ({ page }) => {
  await createCategory(page, "Fun");
  await createCategory(page, "Groceries");
  await addTransaction(page, "Cinema Paradiso");
  await addTransaction(page, "Corner shop", "Groceries");
  await nav(page, "Categories");
  await page.getByLabel("Payee contains").fill("cinema");
  await page.getByLabel("Use category").selectOption({ label: "Fun" });
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByLabel("Payee contains").fill("shop");
  await page.getByLabel("Use category").selectOption({ label: "Fun" });
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByRole("button", { name: "Apply rules to uncategorised transactions" }).click();
  await expect(page.getByRole("status")).toHaveText("Categorised 1 transaction.");
  await nav(page, "Transactions");
  await expect(categoryOf(page, "Cinema Paradiso")).toHaveText("Fun");
  await expect(categoryOf(page, "Corner shop")).toHaveText("Groceries");
});

async function sample(page: Page): Promise<void> {
  for (const name of ["Groceries", "Eating out", "Bills"]) await createCategory(page, name);
  for (const [text, category] of [["corner", "Groceries"], ["electric", "Bills"]]) {
    await page.getByLabel("Payee contains").fill(text);
    await page.getByLabel("Use category").selectOption({ label: category });
    await page.getByRole("button", { name: "Add rule" }).click();
  }
  await expect(page.getByRole("table", { name: "Rules" }).locator("tbody tr")).toHaveCount(2);
  await page.getByLabel("Payee contains").blur();
}

test("tier 1: accessibility structure is identical everywhere", async ({ page }) => {
  await sample(page);
  await expect(page.locator("main")).toMatchAriaSnapshot({ name: "categories.aria.yml" });
});

test("tier 2: layout geometry stays within tolerance everywhere", async ({ page }) => {
  await sample(page);
  assertGeometry(join(test.info().project.testDir, "__snapshots__", "categories.spec.ts", "categories.geometry.json"), await captureGeometry(page));
});

test("tier 3: pixels match the per-OS baseline", async ({ page }, testInfo) => {
  const name = `categories-${testInfo.project.name}-${platform}.png`;
  const baseline = join(testInfo.project.testDir, "__snapshots__", "categories.spec.ts", name);
  test.skip(!process.env.CI && !existsSync(baseline), "no local pixel baseline; the snapshots workflow captures them on the runners");
  await sample(page);
  await expect(page).toHaveScreenshot(name, { fullPage: true });
});
