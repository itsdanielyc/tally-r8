// The ledger file. One JSON document, `ledger.json` in the data folder,
// written so that a crash or power loss at any moment leaves either the old
// ledger or the new one on disk, never a mix:
//   1. write the whole ledger to `ledger.json.tmp` and fsync it;
//   2. rename it over `ledger.json` (atomic on every OS Tally supports);
//   3. fsync the folder, so the rename itself survives a power cut (POSIX).
// The temp file is never read back. A ledger.json that does not parse, or
// that a newer Tally wrote, is never written over.
import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { emptyLedger, type Ledger } from "../core/ledger";
import type { LedgerStore, OpenedLedger } from "../core/service";
import { migrate } from "./migrate";

export const LEDGER_FILE = "ledger.json";

/** The three steps of a save, injectable so L3 can fail each one. */
export type SaveOps = {
  writeTemp(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  syncDir(dir: string): Promise<void>;
};

const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * Windows refuses a rename for a moment while another process (an indexer,
 * an antivirus scan) has the target open. Retry those errors briefly.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  rename: (a: string, b: string) => Promise<void> = fsp.rename,
  attempts = 10,
): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!TRANSIENT.has(code) || i >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * i));
    }
  }
}

export const realOps: SaveOps = {
  async writeTemp(path, data) {
    const handle = await fsp.open(path, "w");
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename: (from, to) => renameWithRetry(from, to),
  async syncDir(dir) {
    // Windows cannot open a folder for fsync; NTFS journals the rename.
    if (process.platform === "win32") return;
    const handle = await fsp.open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};

export class FileStore implements LedgerStore {
  readonly file: string;
  private readonly dir: string;
  private readonly ops: SaveOps;

  constructor(dir: string, ops: SaveOps = realOps) {
    this.dir = dir;
    this.ops = ops;
    this.file = join(dir, LEDGER_FILE);
  }

  async save(ledger: Ledger): Promise<void> {
    const temp = `${this.file}.tmp`;
    await this.ops.writeTemp(temp, JSON.stringify(ledger, null, 2) + "\n");
    await this.ops.rename(temp, this.file);
    // The new ledger is in place once the rename returns; the folder fsync
    // only makes that durable sooner, so its failure does not undo the save.
    await this.ops.syncDir(this.dir).catch(() => undefined);
  }
}

function refused(kind: "unreadable" | "newer", file: string, reason: string): OpenedLedger {
  return { ledger: emptyLedger(), status: { kind, message: `Tally could not open ${file}. ${reason} The file has not been changed.` } };
}

async function readLedger(file: string): Promise<OpenedLedger> {
  let text: string;
  try {
    text = await fsp.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ledger: emptyLedger(), status: { kind: "ok" } };
    return refused("unreadable", file, `It could not be read (${(error as Error).message}).`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return refused("unreadable", file, "It is not valid JSON.");
  }
  const migrated = migrate(raw);
  if (!migrated.ok) return refused(migrated.kind, file, migrated.message);
  return { ledger: migrated.ledger, status: { kind: "ok" } };
}

/** Opens (or starts) the ledger in `dir`. A missing file is an empty ledger. */
export async function openLedger(dir: string, ops: SaveOps = realOps): Promise<{ opened: OpenedLedger; store: FileStore }> {
  await fsp.mkdir(dir, { recursive: true });
  const store = new FileStore(dir, ops);
  return { opened: await readLedger(store.file), store };
}
