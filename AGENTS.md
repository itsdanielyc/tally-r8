# Tally

Tally is a desktop expense ledger for one person: type transactions in or
import a bank's CSV, sort them into categories, and see each month against a
budget, with everything in one local file and no network use. Desktop app for
Windows x64, macOS Apple silicon and Linux x64, built with Electron and a
TypeScript renderer. The brief is `PRODUCT.md`; decisions are in `docs/adr/`.

<!-- keel:start -->
## Keel

This repository uses Keel (`keel.json` at the root, profile `electron-web`).
Commands per testing level are listed there; the testing doctrine is in the
`keel-test` skill; `VERIFICATION.md` is the append-only ledger. One agent
builds everything (solo).

## Commands

- lint (L0): `npm run lint` (tsc three times, ESLint with the size limits, knip)
- unit (L1): `npm run test:unit`; contract (L2, mock vs the real backend): `npm run test:contract`
- integration (L3, the ledger file in temp folders): `npm run test:integration`
- ui (L4/L5): `npm run test:ui` (Playwright, chromium, against the labelled mock; starts its own Vite, never reuses one; `TALLY_UI_PORT` when 1420 is taken)
- e2e (L6): `npm run test:e2e` (needs `npm run build` first; each suite gets a temp `TALLY_DATA_DIR`)
- installers (L7): the `installers` workflow; locally `npm run package`
- triage a CI run: `npm run triage [run-id]`
- verify the app end to end: the `verify-tally` skill in `.agents/skills`

## Layout

- `src/`: the renderer (UI). Talks to the backend only through `src/api.ts`
  (the preload bridge, or the labelled mock).
- `electron/`: the main process (the backend), the sandboxed preload and the
  bridge. The bridge is the contract's transport.
- `core/`: pure domain rules shared by the main process and the mock.
- `contracts/`: the types and the `TallyApi` interface both sides implement.
- `tests/`: unit, contract, integration, ui, e2e suites.

## Rules that are not negotiable

1. A claim of "tested" names the level, the platform and the run. Anything
   else is "built". The ledger (`VERIFICATION.md`) is append-only.
2. A new test proves it can fail before it is trusted: break the code path,
   see red, restore, see green.
3. The contract changes only through its own small PR: types in
   `contracts/`, bridge channels, mock updated, contract suite green. Then
   implementations.
4. Pixel baselines are captured by the `snapshots` workflow on the runners,
   never on a laptop.
5. Flaky tests are quarantined with an issue, never deleted, never "fixed"
   by a wider timeout without a found cause.
6. A test enters through the path the app ships. Code no entry point
   reaches is deleted together with its tests, and test-only harness code
   stays out of the product.
7. `lint` stays green with no suppression comment. The size limits in
   `ARCHITECTURE.md` hold, counted across every file a class, component or
   hook is spread over; over the limit is split in the slice that grew it.
8. No floating-point money anywhere: amounts are integers in minor units.

## Where to look

PRODUCT.md (brief), docs/adr/ (decisions), ARCHITECTURE.md (boundaries),
TESTING.md (strategy), PLAN.md (slices), VERIFICATION.md (evidence),
DESIGN.md (UI decisions).
<!-- keel:end -->
