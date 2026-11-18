// L6: recording transactions in the real app. Every step goes through the
// preload bridge and IPC to the main process and its ledger file; restarts
// and a hard kill are real process exits.
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Snapshot, Transaction } from "../../contracts/tally";
import { formatAmount } from "../../core/money";
import { launch, removeDir, tempDataDir, type Launched } from "./launch";

type Entry = { date: string; amount: string; payee: string; note?: string; income?: boolean };

async function add(win: Page, e: Entry): Promise<void> {
  await win.getByLabel("Date").fill(e.date);
  await win.getByRole("radio", { name: e.income ? "Income" : "Spending" }).check();
  await win.getByLabel("Amount").fill(e.amount);
  await win.getByLabel("Payee").fill(e.payee);
  await win.getByLabel("Note").fill(e.note ?? "");
  await win.getByRole("button", { name: "Add" }).click();
  await expect(win.locator("tbody tr").filter({ hasText: e.payee }).first()).toBeVisible();
}

async function shown(win: Page): Promise<string[][]> {
  return win.locator("tbody tr").evaluateAll((trs) =>
    trs.map((tr) => [...tr.querySelectorAll("td")].slice(0, 5).map((td) => td.textContent ?? "")));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const dir = tempDataDir();
const file = join(dir, "ledger.json");
let s: Launched;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  s = await launch(dir);
});
test.afterAll(async () => {
  await s?.app.close();
  removeDir(dir);
});

test("adds transactions through the main process, and the ledger file holds them", async () => {
  await add(s.win, { date: "2026-11-02", amount: "12.50", payee: "Corner shop", note: "milk" });
  await add(s.win, { date: "2026-11-01", amount: "2500", payee: "Employer", income: true });
  const doc = JSON.parse(readFileSync(file, "utf8"));
  expect(doc.version).toBe(3);
  expect(doc.transactions.map((t: { payee: string; amount: number }) => [t.payee, t.amount])).toEqual([
    ["Corner shop", -1250],
    ["Employer", 250000],
  ]);
});

test("the bridge answers load() with the contract's Snapshot", async () => {
  const snap: Snapshot = await s.win.evaluate(() => window.tallyBridge!.load());
  expect(snap.status).toEqual({ kind: "ok" });
  expect(snap.file).toBe(file);
  expect(snap.settings).toEqual({ currency: "USD" });
  expect(snap.transactions).toEqual([
    { id: "t1", date: "2026-11-02", payee: "Corner shop", amount: -1250, categoryId: null, note: "milk" },
    { id: "t2", date: "2026-11-01", payee: "Employer", amount: 250000, categoryId: null, note: "" },
  ]);
});

test("every transaction is unchanged after the app restarts", async () => {
  const before = await shown(s.win);
  expect(before).toHaveLength(2);
  await s.app.close();
  s = await launch(dir);
  await expect(s.win.locator("tbody tr")).toHaveCount(2);
  expect(await shown(s.win)).toEqual(before);
});

test("an edit and a delete are kept across a restart", async () => {
  await s.win.locator("tbody tr").filter({ hasText: "Corner shop" }).getByRole("button", { name: "Edit" }).click();
  await s.win.getByLabel("Amount").fill("13.75");
  await s.win.getByLabel("Payee").fill("Corner deli");
  await s.win.getByRole("button", { name: "Save" }).click();
  await expect(s.win.locator("tbody tr").filter({ hasText: "Corner deli" })).toBeVisible();
  const employer = s.win.locator("tbody tr").filter({ hasText: "Employer" });
  await employer.getByRole("button", { name: "Delete" }).click();
  await employer.getByRole("button", { name: "Yes, delete" }).click();
  await expect(s.win.locator("tbody tr")).toHaveCount(1);

  await s.app.close();
  s = await launch(dir);
  expect(await shown(s.win)).toEqual([["2026-11-02", "Corner deli", "Uncategorised", "milk", "-13.75"]]);
});

test("after a hard kill right after a change, the ledger opens with that change", async () => {
  await add(s.win, { date: "2026-11-04", amount: "3.20", payee: "Saved before the kill" });
  // The main process itself, by its own pid: on Windows the ChildProcess
  // Playwright holds is a launcher wrapper, and killing it leaves Electron up.
  const pid = await s.app.evaluate(() => process.pid);
  process.kill(pid, "SIGKILL");
  await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false);
  s = await launch(dir);
  await expect(s.win.locator(".banner")).toHaveCount(0);
  expect((await shown(s.win)).map((r) => r[1])).toEqual(["Saved before the kill", "Corner deli"]);
});

test("the summary of the current month adds up what was recorded in it", async () => {
  // The app opens the summary on today's month, by the same local clock as this test.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  await add(s.win, { date: today, amount: "7.25", payee: "Recorded today" });
  const doc = JSON.parse(readFileSync(file, "utf8")) as { transactions: Transaction[] };
  const net = doc.transactions.filter((t) => t.date.startsWith(today.slice(0, 7))).reduce((sum, t) => sum + t.amount, 0);
  await s.win.getByRole("navigation").getByRole("button", { name: "Summary", exact: true }).click();
  await expect(s.win.getByTestId("month-total")).toHaveText((net > 0 ? "+" : "") + formatAmount(net, 2));
  await expect(s.win.getByRole("table", { name: "Transactions this month" })).toContainText("Recorded today");
  await s.win.getByRole("navigation").getByRole("button", { name: "Transactions", exact: true }).click();
});

test("saves a screenshot named after the platform", async () => {
  const main = await s.app.evaluate(() => ({ os: process.platform, arch: process.arch }));
  const out = join(process.cwd(), "artifacts", "e2e");
  mkdirSync(out, { recursive: true });
  await s.win.screenshot({ path: join(out, `${main.os}-${main.arch}.png`) });
});

test("logged no console errors", async () => {
  expect(s.errors).toEqual([]);
});

test("a ledger file it cannot read is shown as such and never written over", async () => {
  const other = tempDataDir();
  const garbage = '{"version": 1, "transactions": [';
  writeFileSync(join(other, "ledger.json"), garbage);
  const t = await launch(other);
  try {
    await expect(t.win.getByRole("alert").filter({ hasText: "could not open" })).toContainText(join(other, "ledger.json"));
    await expect(t.win.getByRole("button", { name: "Add" })).toBeDisabled();
    const r = await t.win.evaluate(() =>
      window.tallyBridge!.addTransaction({ date: "2026-11-02", payee: "x", amount: -1, categoryId: null, note: "" }));
    expect(r.ok ? "ok" : r.error.code).toBe("readonly");
  } finally {
    await t.app.close();
  }
  expect(readFileSync(join(other, "ledger.json"), "utf8")).toBe(garbage);
  removeDir(other);
});
