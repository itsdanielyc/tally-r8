// L4 (behaviour against the labelled mock) and L5 (the three visual tiers)
// for the Transactions screen. Chromium only (Electron is Chromium); in CI on
// all three OS runners. The clock is fixed so the form's default date, and
// with it every snapshot, is the same on every day the suite runs.
import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertGeometry, captureGeometry } from "./geometry";

const platform = process.platform;

type Entry = { date: string; amount: string; payee: string; note?: string; income?: boolean };

async function add(page: Page, e: Entry): Promise<void> {
  await page.getByLabel("Date").fill(e.date);
  await page.getByRole("radio", { name: e.income ? "Income" : "Spending" }).check();
  await page.getByLabel("Amount").fill(e.amount);
  await page.getByLabel("Payee").fill(e.payee);
  await page.getByLabel("Note").fill(e.note ?? "");
  await page.getByRole("button", { name: "Add" }).click();
}

const rows = (page: Page) => page.getByRole("table", { name: "Transactions" }).locator("tbody tr");
const row = (page: Page, payee: string) => rows(page).filter({ hasText: payee });

async function cells(page: Page): Promise<string[][]> {
  return rows(page).evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll("td")].slice(0, 5).map((td) => td.textContent ?? "")));
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-18T10:00:00"));
  await page.goto("/");
  await expect(page.getByTestId("backend-badge")).toHaveText("mock");
});

test("starts empty, with today's date in the form", async ({ page }) => {
  await expect(page.getByText("No transactions yet. Add the first one above, or import a bank CSV.")).toBeVisible();
  await expect(page.getByTestId("count")).toHaveText("0 transactions");
  await expect(page.getByLabel("Date")).toHaveValue("2026-11-18");
  await expect(page.getByRole("radio", { name: "Spending" })).toBeChecked();
  await expect(page.getByTestId("ledger-file")).toHaveText("memory");
});

test("adds spending and income, signed, newest first", async ({ page }) => {
  await add(page, { date: "2026-11-02", amount: "12.50", payee: "Corner shop", note: "milk" });
  await add(page, { date: "2026-11-01", amount: "2,500", payee: "Employer", income: true });
  await add(page, { date: "2026-11-03", amount: "4,80", payee: "Bakery" });
  expect(await cells(page)).toEqual([
    ["2026-11-03", "Bakery", "Uncategorised", "", "-4.80"],
    ["2026-11-02", "Corner shop", "Uncategorised", "milk", "-12.50"],
    ["2026-11-01", "Employer", "Uncategorised", "", "+2,500.00"],
  ]);
  await expect(page.getByTestId("count")).toHaveText("3 transactions");
  // The form is ready for the next entry: emptied, amount focused.
  await expect(page.getByLabel("Amount")).toBeFocused();
  await expect(page.getByLabel("Payee")).toHaveValue("");
});

test("on the same date, the most recently added is listed first", async ({ page }) => {
  await add(page, { date: "2026-11-05", amount: "1", payee: "First" });
  await add(page, { date: "2026-11-05", amount: "2", payee: "Second" });
  expect((await cells(page)).map((c) => c[1])).toEqual(["Second", "First"]);
});

test("refuses what is not a transaction, says why, and keeps what was typed", async ({ page }) => {
  const error = page.locator("#entry-error");
  await add(page, { date: "2026-11-02", amount: "12.50", payee: "   " });
  await expect(error).toHaveText("Payee cannot be empty.");
  await expect(page.getByLabel("Payee")).toHaveAttribute("aria-invalid", "true");
  await add(page, { date: "2026-11-02", amount: "12.345", payee: "Shop" });
  await expect(error).toHaveText('Amount "12.345" has more than 2 decimal places.');
  await add(page, { date: "2026-11-02", amount: "-5", payee: "Shop" });
  await expect(error).toHaveText("Type the amount without a sign; choose Spending or Income.");
  await add(page, { date: "2026-11-02", amount: "0", payee: "Shop" });
  await expect(error).toHaveText("Amount cannot be zero.");
  await expect(page.getByLabel("Payee")).toHaveValue("Shop");
  await expect(page.getByTestId("count")).toHaveText("0 transactions");
});

test("edits a transaction in the form, and Escape cancels an edit", async ({ page }) => {
  await add(page, { date: "2026-11-02", amount: "12.50", payee: "Corner shop", note: "milk" });
  await row(page, "Corner shop").getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("form", { name: "Edit transaction" });
  await expect(form).toBeVisible();
  await expect(page.getByLabel("Amount")).toHaveValue("12.50");
  await expect(page.getByLabel("Note")).toHaveValue("milk");
  await page.getByLabel("Payee").fill("Corner deli");
  await page.getByRole("radio", { name: "Income" }).check();
  await page.getByRole("button", { name: "Save" }).click();
  expect(await cells(page)).toEqual([["2026-11-02", "Corner deli", "Uncategorised", "milk", "+12.50"]]);
  await expect(page.getByRole("form", { name: "New transaction" })).toBeVisible();

  await row(page, "Corner deli").getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Payee").fill("Not saved");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("form", { name: "New transaction" })).toBeVisible();
  expect((await cells(page))[0][1]).toBe("Corner deli");
});

// Bug hunt L8: two submits before the first finished used to add the transaction twice.
test("a double submit adds the transaction once", async ({ page }) => {
  await page.getByLabel("Amount").fill("3");
  await page.getByLabel("Payee").fill("Once only");
  await page.getByRole("form", { name: "New transaction" }).evaluate((f: HTMLFormElement) => {
    f.requestSubmit();
    f.requestSubmit();
  });
  await expect(page.getByTestId("count")).toHaveText("1 transaction");
  await page.waitForTimeout(200);
  await expect(page.getByTestId("count")).toHaveText("1 transaction");
});

test("deletes only after confirming in the row", async ({ page }) => {
  await add(page, { date: "2026-11-02", amount: "12.50", payee: "Corner shop" });
  await add(page, { date: "2026-11-03", amount: "3", payee: "Bakery" });
  await row(page, "Bakery").getByRole("button", { name: "Delete" }).click();
  await row(page, "Bakery").getByRole("button", { name: "Keep" }).click();
  await expect(rows(page)).toHaveCount(2);
  await row(page, "Bakery").getByRole("button", { name: "Delete" }).click();
  await row(page, "Bakery").getByRole("button", { name: "Yes, delete" }).click();
  expect((await cells(page)).map((c) => c[1])).toEqual(["Corner shop"]);
});

test("the currency changes freely while empty, and only to the same digits once there are transactions", async ({ page }) => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("combobox", { name: "Currency" }).selectOption("JPY");
  await page.getByRole("button", { name: "Save currency" }).click();
  await expect(page.getByRole("combobox", { name: "Currency" })).toHaveValue("JPY");
  await page.getByRole("combobox", { name: "Currency" }).selectOption("EUR");
  await page.getByRole("button", { name: "Save currency" }).click();

  await page.getByRole("button", { name: "Transactions" }).click();
  await add(page, { date: "2026-11-02", amount: "12.50", payee: "Corner shop" });
  await expect(page.getByRole("columnheader", { name: "Amount (EUR)" })).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("combobox", { name: "Currency" }).selectOption("JPY");
  await page.getByRole("button", { name: "Save currency" }).click();
  await expect(page.locator("#currency-message")).toContainText("JPY has 0 decimal places and EUR has 2");
  await page.getByRole("combobox", { name: "Currency" }).selectOption("GBP");
  await page.getByRole("button", { name: "Save currency" }).click();
  await page.getByRole("button", { name: "Transactions" }).click();
  await expect(page.getByRole("columnheader", { name: "Amount (GBP)" })).toBeVisible();
  expect((await cells(page))[0][4]).toBe("-12.50");
});

async function sample(page: Page): Promise<void> {
  await add(page, { date: "2026-11-02", amount: "12.50", payee: "Corner shop", note: "milk" });
  await add(page, { date: "2026-11-01", amount: "2500", payee: "Employer", note: "November", income: true });
  await add(page, { date: "2026-10-28", amount: "64.20", payee: "Electricity" });
  await page.getByLabel("Amount").blur();
}

test("tier 1: accessibility structure is identical everywhere", async ({ page }) => {
  await sample(page);
  await expect(page.locator("body")).toMatchAriaSnapshot({ name: "transactions.aria.yml" });
});

test("tier 2: layout geometry stays within tolerance everywhere", async ({ page }) => {
  await sample(page);
  const file = join(test.info().project.testDir, "__snapshots__", "transactions.spec.ts", "transactions.geometry.json");
  assertGeometry(file, await captureGeometry(page));
});

test("tier 3: pixels match the per-OS baseline", async ({ page }, testInfo) => {
  // Baselines are captured in CI by the snapshots workflow, never on a laptop.
  const name = `transactions-${testInfo.project.name}-${platform}.png`;
  const baseline = join(testInfo.project.testDir, "__snapshots__", "transactions.spec.ts", name);
  test.skip(!process.env.CI && !existsSync(baseline), "no local pixel baseline; the snapshots workflow captures them on the runners");
  await sample(page);
  await expect(page).toHaveScreenshot(name, { fullPage: true });
});
