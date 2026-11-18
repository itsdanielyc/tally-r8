// The labelled mock: what answers when the renderer runs in a plain browser
// (the Vite dev server, the Playwright UI suite) where no preload exists. It is
// the same core service the main process runs, on memory instead of a file, so
// it is not a second hand-written backend; the contract suite holds the two to
// the same answers. It says what it is: kind "mock" and the visible badge.
// Where the main process shows an OS dialog, the mock uses the browser's own
// file input; it reads files as UTF-8 only.
import type { PickedFile, Result, TallyApi } from "../contracts/tally";
import { emptyLedger } from "../core/ledger";
import { type LedgerStore, TallyService } from "../core/service";

export interface Backend extends TallyApi {
  readonly kind: "native" | "mock";
}

const memory: LedgerStore = { file: "memory", save: async () => undefined };
const MAX_BYTES = 10 * 1024 * 1024;

function pickInBrowser(): Promise<Result<PickedFile | null>> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.txt,text/csv";
    input.addEventListener("cancel", () => resolve({ ok: true, value: null }));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve({ ok: true, value: null });
      if (file.size > MAX_BYTES) return resolve({ ok: false, error: { code: "invalid", message: `${file.name} is larger than 10 MB.` } });
      file.text().then(
        (text) => resolve({ ok: true, value: { name: file.name, text } }),
        (error: unknown) => resolve({ ok: false, error: { code: "io", message: String(error) } }),
      );
    });
    input.click();
  });
}

export function createMock(): Backend {
  const service = new TallyService({ ledger: emptyLedger(), status: { kind: "ok" } }, memory);
  return {
    kind: "mock",
    load: () => service.load(),
    addTransaction: (input) => service.addTransaction(input),
    updateTransaction: (id, input) => service.updateTransaction(id, input),
    deleteTransaction: (id) => service.deleteTransaction(id),
    setCurrency: (code) => service.setCurrency(code),
    importCsv: (text, mapping) => service.importCsv(text, mapping),
    createCategory: (name) => service.createCategory(name),
    renameCategory: (id, name) => service.renameCategory(id, name),
    deleteCategory: (id) => service.deleteCategory(id),
    mergeCategories: (fromId, intoId) => service.mergeCategories(fromId, intoId),
    createRule: (contains, categoryId) => service.createRule(contains, categoryId),
    deleteRule: (id) => service.deleteRule(id),
    applyRules: () => service.applyRules(),
    pickCsvFile: () => pickInBrowser(),
  };
}
