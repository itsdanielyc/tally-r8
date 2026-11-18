// The backend's commands: one IPC handler per bridge call. The renderer is
// untrusted, so every argument arrives as unknown; plain values are checked
// here and inputs are validated field by field by core/ before use.
import { ipcMain } from "electron";
import type { TransactionInput } from "../contracts/tally";
import type { TallyService } from "../core/service";
import { channels } from "./bridge";

const text = (value: unknown): string => (typeof value === "string" ? value : "");
// The service checks every field of an input object; the cast only names it.
const input = (value: unknown): TransactionInput => value as TransactionInput;

export function registerIpc(service: TallyService): void {
  ipcMain.handle(channels.load, () => service.load());
  ipcMain.handle(channels.addTransaction, (_e, value: unknown) => service.addTransaction(input(value)));
  ipcMain.handle(channels.updateTransaction, (_e, id: unknown, value: unknown) => service.updateTransaction(text(id), input(value)));
  ipcMain.handle(channels.deleteTransaction, (_e, id: unknown) => service.deleteTransaction(text(id)));
  ipcMain.handle(channels.setCurrency, (_e, code: unknown) => service.setCurrency(text(code)));
}
