// L6: the shell itself. The built app starts, its renderer is sandboxed and
// sees only the bridge, the main process reports the platform it runs on, and
// nothing logs an error (a CSP mistake or a failed load shows up here).
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launch, removeDir, tempDataDir, type Launched } from "./launch";

let s: Launched;
const dir = tempDataDir();

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  s = await launch(dir);
});
test.afterAll(async () => {
  await s?.app.close();
  removeDir(dir);
});

test("renders the main window with the native backend and the ledger file", async () => {
  // The title comes from index.html, so it is checked against the page itself.
  const title = /<title>(.*?)<\/title>/.exec(readFileSync("index.html", "utf8"))?.[1];
  expect(title).toBe("Tally");
  await expect(s.win).toHaveTitle("Tally");
  await expect(s.win.getByRole("heading", { level: 1 })).toHaveText("Transactions");
  await expect(s.win.getByTestId("ledger-file")).toHaveText(join(dir, "ledger.json"));
});

test("the renderer sees the bridge and nothing of Node (contextIsolation and the sandbox)", async () => {
  const exposed = await s.win.evaluate(() => ({
    bridge: typeof window.tallyBridge,
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
  }));
  expect(exposed).toEqual({ bridge: "object", require: "undefined", process: "undefined" });
});

test("the main process reports a Tier 1 platform and runs unpackaged from out/", async () => {
  const main = await s.app.evaluate(({ app }) => ({ os: process.platform, arch: process.arch, packaged: app.isPackaged }));
  expect(["win32", "darwin", "linux"]).toContain(main.os);
  expect(["x64", "arm64"]).toContain(main.arch);
  expect(main.packaged).toBe(false);
});

test("logged no console errors (CSP violations, failed loads)", async () => {
  expect(s.errors).toEqual([]);
});
