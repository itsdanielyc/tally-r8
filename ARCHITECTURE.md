# Architecture

Tally is an Electron app (ADR 001) with a TypeScript renderer built by Vite.
The main process owns the ledger file and the file dialogs; the renderer is
sandboxed and reaches them only through the typed preload bridge.

## Module map

| Module | Responsible for | May call | Never knows about |
|---|---|---|---|
| UI: `src/app.ts`, `src/views/`, `src/dom.ts` | screens, their state, rendering a `Snapshot` | the adapter; pure queries in `core/` (format, filter, summary, import plan) | files, Electron, IPC, how the mock stores data |
| Adapter: `src/api.ts`, `src/mock.ts` | one typed `TallyApi`: the native bridge, or the labelled mock (core service on memory, browser file chooser and download) | `window.tallyBridge`, or `core/` | screens |
| Backend commands: `electron/ipc.ts`, `electron/preload.ts`, `electron/bridge.ts`, `electron/backend.ts` | one IPC channel per `TallyApi` call; checks every argument the renderer sends | `core/service.ts`, `electron/store.ts`, `electron/dialogs.ts` | the DOM, the UI's state |
| Domain: `core/` | pure rules: money, dates, validation, CSV parse and import plan, categories and rules, monthly summary, filter, export, the service (the one save pipeline and undo) | only `core/` and `contracts/` | I/O of any kind, Electron, the DOM |
| Persistence: `electron/store.ts`, `electron/migrate.ts` | the ledger file: versioned JSON, migrations, crash-safe writes | `node:fs`, `contracts/` | IPC, the UI |
| Platform: `electron/main.ts`, `electron/dialogs.ts`, `electron/files.ts` | window, app lifecycle, data folder, open and save dialogs, reading and decoding a picked file | `electron`, `node:fs` | ledger rules |

Where a new feature goes: a rule about money, dates, transactions,
categories or CSV is a pure function in `core/`; a new call is a `TallyApi`
method in `contracts/tally.ts`, a channel in `electron/bridge.ts`, a handler
in `electron/ipc.ts` and a method on the service; a screen is a file in
`src/views/`.

## The seam

- `contracts/tally.ts` holds every type that crosses the bridge (`Snapshot`,
  `Transaction`, `TransactionInput`, `Category`, `Rule`, `ImportOptions`,
  `Result`) and the `TallyApi` interface. There is one TypeScript source of
  truth, so there is nothing to generate and nothing to drift by generation.
- Every mutation returns `Result<Snapshot>`: the whole ledger after the
  change, or an error with a code and a message. Errors never travel as
  thrown exceptions across IPC.
- The labelled mock (`src/mock.ts`) implements `TallyApi` with the same
  `core/service.ts` the main process uses, on an in-memory store. It is not a
  second hand-written shape. It announces itself: `kind: "mock"` and the
  visible badge.
- Drift detection: the L2 contract suite (`tests/contract/`) runs one script
  of calls against the mock and against the real backend (the service on
  `electron/store.ts` in a temp folder, reloaded from disk between steps)
  and compares the snapshots. The L6 suite (`tests/e2e/`) makes calls
  through the real preload and IPC and checks them against the same types.

## State and data

- The main process holds the authoritative ledger in memory and in one file,
  `<userData>/ledger.json`. The renderer holds the last `Snapshot` it was
  given and re-renders from it.
- File shape: `{ version, settings, transactions, categories, rules, nextId }`.
  Amounts are signed integers in minor units (spending negative). Dates are
  `YYYY-MM-DD` calendar strings, never timestamps, so months have no time
  zone.
- Versions: 1 (slice 1), 2 adds `rules` (slice 3), 3 adds category budgets
  (slice 4). Each migration in `electron/migrate.ts` is tested at L3 with a
  fixture file of the older version.
- One save pipeline: every change goes through `TallyService.commit`, which
  serialises changes, writes the file, and only then replaces the in-memory
  ledger. A failed write leaves both unchanged.
- Crash-safe write: write `ledger.json.tmp`, fsync, rename over
  `ledger.json`, fsync the folder (POSIX). The file on disk is always the
  old ledger or the new one.
- A ledger file that does not parse, or has a newer version than the app
  knows, is never touched: the app shows a blocking message naming the file
  and refuses every change.
- Undo is the previous ledger, held in memory, one level, cleared by any
  other change and by a restart.

## Platform integration

- Open and save dialogs live in `electron/dialogs.ts`. The real-shell suite
  cannot see OS dialogs, so two named environment variables bypass them:
  `TALLY_OPEN_PATH` and `TALLY_SAVE_PATH`. `TALLY_DATA_DIR` points the data
  folder at a temp folder for the same suite. Nothing else is test-only.
- The browser build (tests only) has no dialogs: the mock uses a file input
  for import and a download link for export.

## Deliberately simple

- One JSON file rewritten on every change, not a database. Signal to revisit:
  a save over 200 ms at L3 with 50,000 transactions.
- Every mutation returns the whole ledger. Signal: an IPC round trip over
  50 ms with 20,000 transactions.
- Plain DOM views with a small element helper, no UI framework. Signal: a
  view that cannot stay inside the size limits by splitting.

## Code-size limits

Enforced by `npm run lint` (L0, ESLint): 400 lines a file, 80 lines a
function, depth 4, complexity 15, 5 parameters. Checked in review: one
class, view or module object at most 400 lines and 25 public members,
counted across every file it is spread over. One orchestrator per pipeline:
one importer (`core/import-plan.ts`), one exporter (`core/csv-export.ts`),
one save pipeline (`TallyService.commit`). A limit is raised only by an ADR,
never by a suppression comment.
