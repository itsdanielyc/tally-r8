// The main process: the backend. It opens the ledger in the data folder,
// answers the bridge's IPC calls through the one service, and owns the window.
import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { openBackend } from "./backend";
import { registerIpc } from "./ipc";

// The real-shell suite gives every run its own data folder. Nothing else sets
// this; without it the ledger lives in the normal per-user app data folder.
const dataDir = process.env.TALLY_DATA_DIR;
if (dataDir) app.setPath("userData", dataDir);

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1024,
    height: 700,
    title: "Tally",
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  // Links open in the system browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

async function start(): Promise<void> {
  const service = await openBackend(app.getPath("userData"));
  registerIpc(service);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

// Two copies of Tally writing one ledger would overwrite each other's
// changes, so a second launch hands over to the first and quits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  // A main process that cannot start has nothing to show the error in: log it
  // and exit non-zero so the real-shell suite and the installer test both fail.
  app.whenReady().then(start).catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
