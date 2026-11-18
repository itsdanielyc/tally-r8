# Testing strategy

Doctrine: the `keel-test` skill. Evidence: `VERIFICATION.md`. This file is
strategy only; a journey's Tests cell names a file once that test exists.

## Levels

| Level | Tool | Command | Runs |
|---|---|---|---|
| L0 | tsc (renderer, electron, tests), ESLint with the size limits, knip | `npm run lint` | every push, ci `unit` job |
| L1 | Vitest, pure `core/` functions | `npm run test:unit` | every push, ci `unit` job |
| L2 | Vitest contract suite: one call script against the mock and the real backend | `npm run test:contract` | every push, ci `unit` job |
| L3 | Vitest with temp folders: ledger file, crash faults, migrations, import timing | `npm run test:integration` | every push, ci `integration` job on three OSes (file renames differ) |
| L4/L5 | Playwright on chromium against the labelled mock; ARIA, geometry, pixels | `npm run test:ui` | every PR, ci `ui` job on three OSes |
| L6 | Playwright Electron on the built app (`npm run build`) | `npm run test:e2e` | every PR, ci `e2e` job on three OSes |
| L7 | NSIS, dmg, deb and AppImage install, launch, uninstall | `installers` workflow | main and on dispatch, three OSes |

Tier 1 is windows-x64, macos-arm64, linux-x64 (`keel.json`); there is no Tier
2 or 3, so every level above runs on those three runners and nothing else.

## Critical journeys

| Journey | Proven at | Tests |
|---|---|---|
| Record, edit, delete a transaction; still there after a restart | L1, L2, L3, L4, L5, L6 | L1 `tests/unit/transactions.test.ts`, `tests/unit/money.test.ts`, `tests/unit/service.test.ts`; L2 `tests/contract/ledger.contract.test.ts`; L3 `tests/integration/store.test.ts`; L4/L5 `tests/ui/transactions.spec.ts`; L6 `tests/e2e/record.spec.ts` |
| A save interrupted at any step leaves a ledger that opens; older file versions open | L3, L6 | L3 `tests/integration/store.test.ts` (a failure at each write step, unreadable and newer files, version fixtures); L6 `tests/e2e/record.spec.ts` (hard kill after a change, unreadable file left alone) |
| Import a bank CSV: detect, map, preview, rejected rows, duplicates skipped, all or none | L1, L2, L3, L4, L5, L6 | |
| A 2,000-row CSV imports in under five seconds | L3 | |
| Categorise by hand and by payee rules; delete and merge categories | L1, L2, L3, L4, L5 | |
| A month: totals per category, income against spending, budgets left or over | L1, L4, L5, L6 | |
| Find, filter, export; the export imports back as the same transactions | L1, L2, L4, L5, L6 | |
| Undo the last delete, merge or import, once | L1, L2, L4, L6 | |
| First launch from the installer | L7 | `scripts/installer-test.ps1`, `scripts/installer-test.sh` |

## Visual

Tiers 1 to 3 for every screen: ARIA snapshot (shared), geometry JSON
(shared, 8 px), full-page pixels per OS with `maxDiffPixelRatio` 0.002.
Pixel baselines come only from the `snapshots` workflow on the runners.

## Budgets

Fast suite (lint, unit, contract, integration) under 3 minutes locally; ui
and e2e under 5 minutes per OS; PR wall clock under 20 minutes. Flaky tests:
`keel-test` section 6 (quarantine with an issue; one retry at L6 and L7
only).

## Not tested in 0.1.0

- Screen readers and keyboard-only use beyond the ARIA tree: manual, not
  automated, and not claimed.
- Bank CSVs in encodings other than UTF-8 and Windows-1252.
- Power loss at the hardware level: L3 injects a failure at every step of the
  write sequence, which proves the protocol, not the disk's fsync.
- Signed installers: 0.1.0 is unsigned (ADR 001).
