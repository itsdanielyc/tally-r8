# Tally

A desktop expense ledger for one person: type transactions in or import the
CSV your bank exports, sort them into categories, and see each month against
a budget. No bank connection, no account, no network: everything stays in one
local file. Windows x64, macOS Apple silicon and Linux x64.

- What it is for and what it is not: `PRODUCT.md`.
- Installing a release, the signing status and known defects:
  `docs/release-notes-0.1.0.md`. Changes: `CHANGELOG.md`.
- Working on it: start with `AGENTS.md` (this repository uses Keel).

## Commands

```bash
npm install
npm run lint              # tsc three times, ESLint with the size limits, knip
npm run test:unit         # L1
npm run test:contract     # L2: the labelled mock and the real backend answer alike
npm run test:integration  # L3: the ledger file in temp folders
npm run test:ui           # L4/L5: Playwright on chromium against the labelled mock
npm run build             # main, preload and renderer into out/
npm run test:e2e          # L6: Playwright's Electron launcher against the built app
npm run package           # installers into release/ (unsigned)
```
