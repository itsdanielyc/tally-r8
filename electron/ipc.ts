// The backend's commands: one IPC handler per bridge call. The renderer is
// untrusted, so every argument arrives as unknown; plain values are checked
// here and inputs are validated field by field by core/ before use.
import { ipcMain } from "electron";
import type { ImportMapping, PickedFile, Result, TransactionInput } from "../contracts/tally";
import type { TallyService } from "../core/service";
import { channels } from "./bridge";
import { chooseCsvToOpen } from "./dialogs";
import { readCsvFile } from "./files";

const text = (value: unknown): string => (typeof value === "string" ? value : "");
// The service checks every field of these objects; the casts only name them.
const input = (value: unknown): TransactionInput => value as TransactionInput;
const mapping = (value: unknown): ImportMapping => value as ImportMapping;

async function pickCsvFile(): Promise<Result<PickedFile | null>> {
  const path = await chooseCsvToOpen();
  return path === null ? { ok: true, value: null } : readCsvFile(path);
}

export function registerIpc(service: TallyService): void {
  ipcMain.handle(channels.load, () => service.load());
  ipcMain.handle(channels.addTransaction, (_e, value: unknown) => service.addTransaction(input(value)));
  ipcMain.handle(channels.updateTransaction, (_e, id: unknown, value: unknown) => service.updateTransaction(text(id), input(value)));
  ipcMain.handle(channels.deleteTransaction, (_e, id: unknown) => service.deleteTransaction(text(id)));
  ipcMain.handle(channels.setCurrency, (_e, code: unknown) => service.setCurrency(text(code)));
  ipcMain.handle(channels.importCsv, (_e, csv: unknown, value: unknown) => service.importCsv(text(csv), mapping(value)));
  ipcMain.handle(channels.pickCsvFile, () => pickCsvFile());
  ipcMain.handle(channels.createCategory, (_e, name: unknown) => service.createCategory(text(name)));
  ipcMain.handle(channels.renameCategory, (_e, id: unknown, name: unknown) => service.renameCategory(text(id), text(name)));
  ipcMain.handle(channels.deleteCategory, (_e, id: unknown) => service.deleteCategory(text(id)));
  ipcMain.handle(channels.mergeCategories, (_e, fromId: unknown, intoId: unknown) => service.mergeCategories(text(fromId), text(intoId)));
  ipcMain.handle(channels.createRule, (_e, contains: unknown, categoryId: unknown) => service.createRule(text(contains), text(categoryId)));
  ipcMain.handle(channels.deleteRule, (_e, id: unknown) => service.deleteRule(text(id)));
  ipcMain.handle(channels.applyRules, () => service.applyRules());
}
