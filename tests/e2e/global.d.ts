import type { ElectronBridge } from "../../electron/bridge";

declare global {
  interface Window {
    tallyBridge?: ElectronBridge;
  }
}
