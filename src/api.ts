// The seam between the UI and the backend. Inside Electron the calls go
// through the preload bridge (window.tallyBridge) over IPC to the main
// process; in a plain browser a labelled mock answers instead (src/mock.ts).
import type { ElectronBridge } from "../electron/bridge";
import { type Backend, createMock } from "./mock";

export type { Backend };

declare global {
  interface Window {
    tallyBridge?: ElectronBridge;
  }
}

function native(bridge: ElectronBridge): Backend {
  return {
    kind: "native",
    load: () => bridge.load(),
    addTransaction: (input) => bridge.addTransaction(input),
    updateTransaction: (id, input) => bridge.updateTransaction(id, input),
    deleteTransaction: (id) => bridge.deleteTransaction(id),
    setCurrency: (code) => bridge.setCurrency(code),
    importCsv: (text, mapping) => bridge.importCsv(text, mapping),
    createCategory: (name) => bridge.createCategory(name),
    renameCategory: (id, name) => bridge.renameCategory(id, name),
    deleteCategory: (id) => bridge.deleteCategory(id),
    mergeCategories: (fromId, intoId) => bridge.mergeCategories(fromId, intoId),
    createRule: (contains, categoryId) => bridge.createRule(contains, categoryId),
    deleteRule: (id) => bridge.deleteRule(id),
    applyRules: () => bridge.applyRules(),
    setBudget: (categoryId, amount) => bridge.setBudget(categoryId, amount),
    undo: () => bridge.undo(),
    saveCsvFile: (suggestedName, text) => bridge.saveCsvFile(suggestedName, text),
    pickCsvFile: () => bridge.pickCsvFile(),
  };
}

const bridge = typeof window !== "undefined" ? window.tallyBridge : undefined;

export const backend: Backend = bridge ? native(bridge) : createMock();
