---
name: verify-tally
description: How to launch, check, drive and clean up Tally on this machine to prove a behaviour end to end. Use it whenever you need to see the real app do something rather than trust a unit test, before claiming a user-facing change works, or when triaging a real-shell failure.
license: MIT
---

# verify-tally

Read cold, mid-task. Every command below is real for this repository.

## Launch

- Built app for the real-shell suite: `npm run build` writes `out/`; the
  suite launches it through Playwright's Electron launcher. Electron
  downloads its binary on first launch; `node node_modules/electron/install.js`
  fetches it ahead of time (CI does this in its own step).
- A throwaway ledger: set `TALLY_DATA_DIR` to an empty temp folder before
  launching (`npm start`, or the suite's `tests/e2e/launch.ts`). Without it
  the app opens the real per-user ledger; never test against that one.
- Dev loop with hot reload: `npm run dev` (electron-vite); renderer alone
  in a browser: `npm run dev:web` (Vite on port 1420, the labelled mock).
- Ready means: the main window titled "Tally" shows the Transactions
  screen, the status bar names `<data dir>/ledger.json`, and the backend
  badge reads "native".

## Doctor (read-only)

- `node -v` is 24 or newer; the Electron binary is present
  (`node node_modules/electron/install.js` is a no-op when it is).
- `out/main/main.js` exists and is newer than `electron/`, `core/` and `src/`.
- Port 1420 may be held by another app on a shared machine. The UI suite
  never reuses a server it did not start; set `TALLY_UI_PORT` to a free
  port (for example 14281) when 1420 is taken.
- Linux without a display: run the suite under `xvfb-run`.
- No other Tally runs on the same data folder (the second launch would hand
  over to it and quit): `tasklist` / `pgrep -f tally`.

## Drive

- Real shell: `npm run test:e2e` launches `out/` with a temp
  `TALLY_DATA_DIR` per suite; journeys live under `tests/e2e/`
  (`record.spec.ts`: add, restart, edit, delete, hard kill, unreadable file;
  `import.spec.ts`: CSV import, re-import, 2,000 rows).
- The open and save dialogs cannot be driven; `TALLY_OPEN_PATH` and
  `TALLY_SAVE_PATH` (absolute paths) are the files they return
  (`export.spec.ts`: export, re-import into a fresh ledger, undo). Bank CSV fixtures live in `tests/fixtures/csv/`.
- To kill the app hard, kill the main process's own pid
  (`app.evaluate(() => process.pid)`); on Windows the ChildProcess
  Playwright returns is a launcher wrapper.
- Browser against the mock: `npm run test:ui` (chromium); the badge must
  read "mock".
- The bridge directly, from a test: `win.evaluate(() => window.tallyBridge.load())`.
- Stable handles: ARIA roles and labels, `data-testid`, never pixels.

## Evidence

- A screenshot from the real shell lands in `artifacts/e2e/<os>-<arch>.png`.
- The ledger file itself is evidence: read `<data dir>/ledger.json`.
- A behaviour counts as verified when a test asserts it and the ledger row
  names the level, the platform and the run.
- Never weaken a journey to make it pass.

## Cleanup

- Kill only what you started (the suite does this; after a manual launch,
  close the window or kill the one PID you recorded).
- Temp data folders may stay behind for a moment on Windows while Chromium
  helpers exit; they are harmless.
- Evidence (`artifacts/`) survives cleanup and is gitignored.
