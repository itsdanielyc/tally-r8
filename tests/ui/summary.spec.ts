// L4 and L5 for the monthly summary and budgets, against the labelled mock.
// The clock is fixed in November 2026, so the summary opens on that month.
import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertGeometry, captureGeometry } from "./geometry";

const platform = process.platform;
const nav = (page: Page, name: string) => page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
const lines = (page: Page) => page.getByRole("table", { name: "Categories this month" }).locator("tbody tr");
const line = (page: Page, name: string) => lines(page).filter({ has: page.getByRole("cell", { name, exact: true }) });

/** Two categories, two rules, and months.csv imported (October to December). */
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
  await nav(page, "Import");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose a CSV file…" }).click();
  await (await chooser).setFiles(join(import.meta.dirname, "..", "fixtures", "csv", "months.csv"));
  await page.getByRole("button", { name: "Import 7 transactions" }).click();
  await expect(page.getByRole("status")).toContainText("Imported 7 transactions");
  await nav(page, "Summary");
}

async function setBudget(page: Page, category: string, amount: string): Promise<void> {
  await page.getByRole("button", { name: `Set budget for ${category}` }).click();
  await page.getByLabel(`Monthly budget for ${category}`).fill(amount);
  await page.getByRole("button", { name: "Save" }).click();
}

const cents = (text: string) => Math.round(Number(text.replaceAll(",", "")) * 100);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-18T10:00:00"));
  await page.goto("/");
  await expect(page.getByTestId("backend-badge")).toHaveText("mock");
});

test("opens on the current month and shows income against spending", async ({ page }) => {
  await seed(page);
  await expect(page.locator("#month-label")).toHaveText("November 2026");
  await expect(page.getByTestId("stat-income")).toHaveText("+3,015.00");
  await expect(page.getByTestId("stat-spending")).toHaveText("-254.99");
  await expect(page.getByTestId("stat-net")).toHaveText("+2,760.01");
});

test("gives the total per category, refunds included, with uncategorised last", async ({ page }) => {
  await seed(page);
  const rows = await lines(page).evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].slice(0, 2).map((td) => td.textContent)));
  expect(rows).toEqual([["Eating out", "-125.00"], ["Groceries", "-105.00"], ["Uncategorised", "+2,990.01"]]);
});

test("the totals equal the sum of the transactions shown for the month, to the cent", async ({ page }) => {
  await seed(page);
  const shown = await page.getByRole("table", { name: "Transactions this month" }).locator("tbody td.amount").allTextContents();
  expect(shown).toHaveLength(5);
  const sum = shown.reduce((s, text) => s + cents(text), 0);
  expect(cents(await page.getByTestId("month-total").innerText())).toBe(sum);
  expect(cents(await page.getByTestId("stat-net").innerText())).toBe(sum);
  const lineSum = (await lines(page).locator("td.amount").allTextContents()).reduce((s, text) => s + cents(text), 0);
  expect(lineSum).toBe(sum);
});

test("moves to the previous and next month", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "‹ Previous month" }).click();
  await expect(page.locator("#month-label")).toHaveText("October 2026");
  await expect(page.getByTestId("month-total")).toHaveText("-50.00");
  await page.getByRole("button", { name: "Next month ›" }).click();
  await page.getByRole("button", { name: "Next month ›" }).click();
  await expect(page.locator("#month-label")).toHaveText("December 2026");
  await expect(page.getByTestId("month-total")).toHaveText("-70.00");
  await page.getByRole("button", { name: "Next month ›" }).click();
  await expect(page.locator("#month-label")).toHaveText("January 2027");
  await expect(page.getByText("No transactions in January 2027.")).toBeVisible();
});

test("a monthly budget shows what is left, or how much it is over, and can be removed", async ({ page }) => {
  await seed(page);
  await setBudget(page, "Groceries", "400");
  await expect(line(page, "Groceries").locator("td.left")).toHaveText("295.00 left");
  await setBudget(page, "Eating out", "100");
  await expect(line(page, "Eating out").locator("td.left")).toHaveText("25.00 over");
  await page.getByRole("button", { name: "‹ Previous month" }).click();
  await expect(line(page, "Eating out").locator("td.left")).toHaveText("100.00 left");
  await page.getByRole("button", { name: "Change budget for Eating out" }).click();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(line(page, "Eating out")).toHaveCount(0);
});

test("refuses a budget that is not an amount", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Set budget for Groceries" }).click();
  await page.getByLabel("Monthly budget for Groceries").fill("lots");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(line(page, "Groceries").getByRole("alert")).toHaveText('Amount "lots" is not a number.');
});

async function sample(page: Page): Promise<void> {
  await seed(page);
  await setBudget(page, "Groceries", "400");
  await setBudget(page, "Eating out", "100");
  await expect(line(page, "Eating out").locator("td.left")).toHaveText("25.00 over");
}

test("tier 1: accessibility structure is identical everywhere", async ({ page }) => {
  await sample(page);
  await expect(page.locator("main")).toMatchAriaSnapshot({ name: "summary.aria.yml" });
});

test("tier 2: layout geometry stays within tolerance everywhere", async ({ page }) => {
  await sample(page);
  assertGeometry(join(test.info().project.testDir, "__snapshots__", "summary.spec.ts", "summary.geometry.json"), await captureGeometry(page));
});

test("tier 3: pixels match the per-OS baseline", async ({ page }, testInfo) => {
  const name = `summary-${testInfo.project.name}-${platform}.png`;
  const baseline = join(testInfo.project.testDir, "__snapshots__", "summary.spec.ts", name);
  test.skip(!process.env.CI && !existsSync(baseline), "no local pixel baseline; the snapshots workflow captures them on the runners");
  await sample(page);
  await expect(page).toHaveScreenshot(name, { fullPage: true });
});
