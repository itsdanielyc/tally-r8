// Reading a bank's CSV file from disk into text. Banks write UTF-8 (often
// with a byte order mark) or the Windows Latin code page; anything that is not
// valid UTF-8 is read as Windows-1252, so "Café" from an older bank export
// arrives as "Café", not as replacement characters.
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { PickedFile, Result } from "../contracts/tally";

const MAX_CSV_BYTES = 10 * 1024 * 1024;

export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export async function readCsvFile(path: string): Promise<Result<PickedFile>> {
  try {
    const info = await stat(path);
    if (info.size > MAX_CSV_BYTES) {
      return { ok: false, error: { code: "invalid", message: `${basename(path)} is larger than 10 MB, which is more than a bank export should be.` } };
    }
    return { ok: true, value: { name: basename(path), text: decodeCsv(await readFile(path)) } };
  } catch (error) {
    return { ok: false, error: { code: "io", message: `Tally could not read ${path}: ${(error as Error).message}` } };
  }
}
