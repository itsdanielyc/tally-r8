// The typed surface the preload exposes to the renderer as window.tallyBridge,
// and the IPC channel names main and preload share. The bridge is exactly
// TallyApi (contracts/tally.ts) plus the scaffold's sample calls, which go
// when slice 1's screens replace the sample page.
import type { TallyApi } from "../contracts/tally";

export type PlatformInfo = {
  /** process.platform in the main process: win32 | darwin | linux */
  os: string;
  /** process.arch in the main process: x64 | arm64 */
  arch: string;
  /** process.versions.electron */
  electron: string;
  /** app.isPackaged: false when launched from the build output, true when installed */
  packaged: boolean;
};

type SampleBridge = {
  greet(name: string): Promise<string>;
  platformInfo(): Promise<PlatformInfo>;
};

export type ElectronBridge = TallyApi & SampleBridge;

/** One channel per bridge call; `satisfies` fails the build if one is missing. */
export const channels = {
  load: "tally:load",
  addTransaction: "tally:add-transaction",
  updateTransaction: "tally:update-transaction",
  deleteTransaction: "tally:delete-transaction",
  setCurrency: "tally:set-currency",
  greet: "app:greet",
  platformInfo: "app:platform-info",
} as const satisfies Record<keyof ElectronBridge, string>;
