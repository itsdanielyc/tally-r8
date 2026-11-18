// The OS file dialogs. The real-shell suite cannot see or drive them, so one
// named environment variable stands in for the person's choice there:
// TALLY_OPEN_PATH (the file to open) and TALLY_SAVE_PATH (where to save).
// Nothing else bypasses a dialog.
import { BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions } from "electron";

export async function chooseCsvToOpen(): Promise<string | null> {
  const preset = process.env.TALLY_OPEN_PATH;
  if (preset) return preset;
  const options: OpenDialogOptions = {
    title: "Import a bank CSV",
    properties: ["openFile"],
    filters: [{ name: "CSV files", extensions: ["csv", "txt"] }, { name: "All files", extensions: ["*"] }],
  };
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

export async function chooseCsvToSave(suggestedName: string): Promise<string | null> {
  const preset = process.env.TALLY_SAVE_PATH;
  if (preset) return preset;
  const options: SaveDialogOptions = {
    title: "Export transactions",
    defaultPath: suggestedName,
    filters: [{ name: "CSV files", extensions: ["csv"] }],
  };
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  return result.canceled || !result.filePath ? null : result.filePath;
}
