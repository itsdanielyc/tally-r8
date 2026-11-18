// L6: what the person sees when the main process cannot save. The ledger is
// made unwritable the way a locked or read-only file or folder would be;
// the change must be refused, said out loud, and the row kept.
import { expect, test } from "@playwright/test";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { launch, removeDir, tempDataDir } from "./launch";

// Bug hunt L5: a delete that failed used to redraw in silence.
test("a delete that cannot be saved says so and keeps the row", async () => {
  const dir = tempDataDir();
  const file = join(dir, "ledger.json");
  const s = await launch(dir);
  const lock = () => (process.platform === "win32" ? chmodSync(file, 0o444) : chmodSync(dir, 0o555));
  const unlock = () => (process.platform === "win32" ? chmodSync(file, 0o666) : chmodSync(dir, 0o755));
  try {
    await s.win.getByLabel("Amount").fill("4.20");
    await s.win.getByLabel("Payee").fill("Keep me");
    await s.win.getByRole("button", { name: "Add" }).click();
    const row = s.win.locator("tbody tr").filter({ hasText: "Keep me" });
    await expect(row).toHaveCount(1);
    lock();
    await row.getByRole("button", { name: "Delete" }).click();
    await row.getByRole("button", { name: "Yes, delete" }).click();
    await expect(s.win.getByRole("status").filter({ hasText: "could not be saved" })).toContainText("The ledger could not be saved, so the change was not made");
    await expect(s.win.locator("tbody tr").filter({ hasText: "Keep me" })).toHaveCount(1);
    await expect(s.win.getByTestId("undo-bar")).toHaveCount(0);
  } finally {
    unlock();
    await s.app.close();
    removeDir(dir);
  }
});
