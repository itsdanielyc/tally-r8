// L4 and L5 for the Import screen, against the labelled mock. Files are
// picked through the browser's file chooser, which is how the mock asks.
import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertGeometry, captureGeometry } from "./geometry";

const platform = process.platform;
const csv = (name: string) => join(import.meta.dirname, "..", "fixtures", "csv", name);

async function pick(page: Page, name: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Choose (a|another) CSV file/ }).click();
  await (await chooser).setFiles(csv(name));
}

const summary = (page: Page) => page.getByTestId("import-summary");
const previewRows = (page: Page) => page.getByRole("table", { name: "Preview" }).locator("tbody tr");

async function previewCells(page: Page): Promise<string[][]> {
  return previewRows(page).evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent ?? "")));
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-18T10:00:00"));
  await page.goto("/");
  await expect(page.getByTestId("backend-badge")).toHaveText("mock");
  await page.getByRole("button", { name: "Import" }).click();
});

test("detects a comma file, previews the rows as they will be imported, and lists the rows it cannot read", async ({ page }) => {
  await pick(page, "bank-comma.csv");
  await expect(page.getByLabel("Delimiter")).toHaveValue(",");
  await expect(page.getByLabel("Header row")).toHaveValue("0");
  await expect(page.getByLabel("Date column")).toHaveValue("0");
  await expect(page.getByLabel("Payee column")).toHaveValue("1");
  await expect(page.getByLabel("Amount column")).toHaveValue("2");
  await expect(summary(page)).toHaveText("6 rows will be imported · 0 already in the ledger · 2 cannot be read");
  expect((await previewCells(page)).slice(0, 3)).toEqual([
    ["2", "2026-10-01", "Employer, Inc. payroll", "+3,200.00"],
    ["3", "2026-10-02", "Corner shop", "-12.50"],
    ["4", "2026-10-03", 'Rent "October"', "-1,100.00"],
  ]);
  await expect(page.getByRole("region", { name: "Rows that cannot be read" }).getByRole("listitem")).toHaveText([
    'Line 8: date "not a date" is not a year-month-day date',
    'Line 9: amount "abc" is not a number',
  ]);
});

test("imports all accepted rows together, and the same file again adds nothing", async ({ page }) => {
  await pick(page, "bank-comma.csv");
  await page.getByRole("button", { name: "Import 6 transactions" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Imported 6 transactions from bank-comma.csv. 0 rows were already in the ledger and skipped; 2 rows could not be read.");
  await page.getByRole("button", { name: "Transactions" }).click();
  await expect(page.getByTestId("count")).toHaveText("6 transactions");

  await page.getByRole("button", { name: "Import" }).click();
  await pick(page, "bank-comma.csv");
  await expect(summary(page)).toHaveText("0 rows will be imported · 6 already in the ledger · 2 cannot be read");
  await expect(page.getByRole("button", { name: "Import 0 transactions" })).toBeDisabled();
});

test("skips a preamble, finds the header and reads debit and credit columns with decimal commas", async ({ page }) => {
  await pick(page, "bank-semicolon.csv");
  await expect(page.getByLabel("Delimiter")).toHaveValue(";");
  await expect(page.getByLabel("Header row")).toHaveValue("2");
  await expect(page.getByRole("radio", { name: "Debit and credit columns" })).toBeChecked();
  await expect(page.getByLabel("Decimal separator")).toHaveValue(",");
  await expect(summary(page)).toHaveText("4 rows will be imported · 0 already in the ledger · 2 cannot be read");
  expect(await previewCells(page)).toEqual([
    ["5", "2026-10-01", "Employer GmbH", "+3,200.00"],
    ["6", "2026-10-02", "Bakery; Miller", "-4.80"],
    ["7", "2026-10-03", "City power", "-64.20"],
    ["8", "2026-10-04", "Refund shop", "+12.00"],
  ]);
});

test("every mapping change redraws the preview", async ({ page }) => {
  await pick(page, "bank-semicolon.csv");
  await page.getByLabel("Date order").selectOption("MDY");
  expect((await previewCells(page))[0]).toEqual(["5", "2026-01-10", "Employer GmbH", "+3,200.00"]);
  await page.getByLabel("Date order").selectOption("YMD");
  await expect(summary(page)).toHaveText("0 rows will be imported · 0 already in the ledger · 6 cannot be read");
  await expect(page.getByRole("region", { name: "Rows that cannot be read" }).getByRole("listitem").first())
    .toHaveText('Line 5: date "01.10.2026" is not a year-month-day date');
  await page.getByLabel("Date order").selectOption("DMY");
  await page.getByRole("radio", { name: "One column with a sign" }).check();
  await page.getByLabel("Amount column").selectOption({ label: "Credit" });
  const signed = "3 rows will be imported · 0 already in the ledger · 3 cannot be read";
  await expect(summary(page)).toHaveText(signed);
  await page.getByLabel("Delimiter").selectOption(",");
  await expect(page.getByLabel("Delimiter")).toHaveValue(",");
  await expect(summary(page)).not.toHaveText(signed);
});

test("cancel leaves the ledger as it was", async ({ page }) => {
  await pick(page, "bank-comma.csv");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Choose a CSV file…" })).toBeVisible();
  await page.getByRole("button", { name: "Transactions" }).click();
  await expect(page.getByTestId("count")).toHaveText("0 transactions");
});

test("tier 1: accessibility structure is identical everywhere", async ({ page }) => {
  await pick(page, "bank-semicolon.csv");
  await expect(page.locator("main")).toMatchAriaSnapshot({ name: "import.aria.yml" });
});

test("tier 2: layout geometry stays within tolerance everywhere", async ({ page }) => {
  await pick(page, "bank-semicolon.csv");
  const file = join(test.info().project.testDir, "__snapshots__", "import.spec.ts", "import.geometry.json");
  assertGeometry(file, await captureGeometry(page));
});

test("tier 3: pixels match the per-OS baseline", async ({ page }, testInfo) => {
  const name = `import-${testInfo.project.name}-${platform}.png`;
  const baseline = join(testInfo.project.testDir, "__snapshots__", "import.spec.ts", name);
  test.skip(!process.env.CI && !existsSync(baseline), "no local pixel baseline; the snapshots workflow captures them on the runners");
  await pick(page, "bank-semicolon.csv");
  await expect(page).toHaveScreenshot(name, { fullPage: true });
});
