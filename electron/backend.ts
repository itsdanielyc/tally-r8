// The real backend as the main process assembles it: the ledger file in the
// data folder, behind the one service. The contract suite (tests/contract)
// opens it the same way, in a temp folder, and holds it to the mock.
import { TallyService } from "../core/service";
import { openLedger, type SaveOps } from "./store";

export async function openBackend(dataDir: string, ops?: SaveOps): Promise<TallyService> {
  const { opened, store } = await openLedger(dataDir, ops);
  return new TallyService(opened, store);
}
