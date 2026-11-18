// Runs sandboxed with contextIsolation on. It exposes exactly the typed bridge
// and nothing else: no ipcRenderer, no Node.
import { contextBridge, ipcRenderer } from "electron";
import { channels, type ElectronBridge } from "./bridge";

const bridge: ElectronBridge = {
  load: () => ipcRenderer.invoke(channels.load),
  addTransaction: (input) => ipcRenderer.invoke(channels.addTransaction, input),
  updateTransaction: (id, input) => ipcRenderer.invoke(channels.updateTransaction, id, input),
  deleteTransaction: (id) => ipcRenderer.invoke(channels.deleteTransaction, id),
  setCurrency: (code) => ipcRenderer.invoke(channels.setCurrency, code),
  importCsv: (text, mapping) => ipcRenderer.invoke(channels.importCsv, text, mapping),
  createCategory: (name) => ipcRenderer.invoke(channels.createCategory, name),
  renameCategory: (id, name) => ipcRenderer.invoke(channels.renameCategory, id, name),
  deleteCategory: (id) => ipcRenderer.invoke(channels.deleteCategory, id),
  mergeCategories: (fromId, intoId) => ipcRenderer.invoke(channels.mergeCategories, fromId, intoId),
  createRule: (contains, categoryId) => ipcRenderer.invoke(channels.createRule, contains, categoryId),
  deleteRule: (id) => ipcRenderer.invoke(channels.deleteRule, id),
  applyRules: () => ipcRenderer.invoke(channels.applyRules),
  pickCsvFile: () => ipcRenderer.invoke(channels.pickCsvFile),
};

contextBridge.exposeInMainWorld("tallyBridge", bridge);
