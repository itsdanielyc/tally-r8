// The labelled mock: what answers when the renderer runs in a plain browser
// (the Vite dev server, the Playwright UI suite) where no preload exists. It is
// the same core service the main process runs, on memory instead of a file, so
// it is not a second hand-written backend; the contract suite holds the two to
// the same answers. It says what it is: kind "mock" and the visible badge.
import type { TallyApi } from "../contracts/tally";
import { emptyLedger } from "../core/ledger";
import { type LedgerStore, TallyService } from "../core/service";

export interface Backend extends TallyApi {
  readonly kind: "native" | "mock";
}

const memory: LedgerStore = { file: "memory", save: async () => undefined };

export function createMock(): Backend {
  const service = new TallyService({ ledger: emptyLedger(), status: { kind: "ok" } }, memory);
  return {
    kind: "mock",
    load: () => service.load(),
    addTransaction: (input) => service.addTransaction(input),
    updateTransaction: (id, input) => service.updateTransaction(id, input),
    deleteTransaction: (id) => service.deleteTransaction(id),
    setCurrency: (code) => service.setCurrency(code),
  };
}
