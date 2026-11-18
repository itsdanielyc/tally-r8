// Launches the built app (out/, from `npm run build`) the way a person would,
// with one test-only difference: TALLY_DATA_DIR points the data folder at a
// temp folder, so each suite has its own ledger and never touches a real one.
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Launched = { app: ElectronApplication; win: Page; errors: string[] };

export function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), "tally-e2e-"));
}

export function removeDir(dir: string): void {
  // Chromium helpers can hold profile files for a moment after exit.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    /* a leftover temp folder is harmless */
  }
}

export async function launch(dataDir: string): Promise<Launched> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.TALLY_DATA_DIR = dataDir;
  const app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
  const win = await app.firstWindow();
  const errors: string[] = [];
  win.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await win.waitForLoadState("domcontentloaded");
  // The badge proves the UI is talking to the main process, not the mock.
  await expect(win.getByTestId("backend-badge")).toHaveText("native");
  return { app, win, errors };
}
