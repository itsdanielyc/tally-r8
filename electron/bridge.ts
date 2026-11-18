// The typed surface the preload exposes to the renderer as window.tallyBridge,
// and the IPC channel names main and preload share. The bridge is exactly
// TallyApi from contracts/tally.ts.
import type { TallyApi } from "../contracts/tally";

export type ElectronBridge = TallyApi;

/** One channel per bridge call; `satisfies` fails the build if one is missing. */
export const channels = {
  load: "tally:load",
  addTransaction: "tally:add-transaction",
  updateTransaction: "tally:update-transaction",
  deleteTransaction: "tally:delete-transaction",
  setCurrency: "tally:set-currency",
} as const satisfies Record<keyof ElectronBridge, string>;
