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
};

contextBridge.exposeInMainWorld("tallyBridge", bridge);
