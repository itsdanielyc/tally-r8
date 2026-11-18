# Plan

The slices are fixed by `SLICES.md`; this file adds each slice's "done when",
levels and owner. One agent builds everything (solo). Tier 1 is
windows-latest, macos-latest and ubuntu-latest; "green" means green on all
three for every level the slice names.

| # | Slice | Done when | Levels | Owner | Status |
|---|---|---|---|---|---|
| 0 | Scaffold | The `electron-web` scaffold is green on the three Tier 1 runners: ci (lint, unit, ui, e2e) and installers; pixel baselines from the snapshots workflow; the first ledger row names the runs | L0, L1, L2, L4, L5, L6, L7 | solo | done: ci 44365019289 and installers 44354900013 green on all three |
| 1 | Record transactions | L1 `tests/unit/money.test.ts`, `tests/unit/transactions.test.ts` (parse and format minor units, validation, newest first, currency rule); L2 `tests/contract/ledger.contract.test.ts` (add, edit, delete, currency: mock equals real backend after a reload); L3 `tests/integration/store.test.ts` (versioned file, reload unchanged, a failure at every write step leaves a ledger that opens, unreadable and newer files untouched); L4 `tests/ui/transactions.spec.ts` (add, edit, delete, newest first, validation, currency); L5 tiers 1 to 3 of the transactions screen; L6 `tests/e2e/record.spec.ts` (add in the real app, restart, unchanged; hard kill, relaunch, ledger opens) | L0 to L6 | solo | done: PRs #4 and #7, ci 44369095329 and 44382974013 green on all three |
| 2 | Import a bank CSV | L1 `tests/unit/csv-parse.test.ts` (comma, semicolon, tab, quoted fields, header row), `tests/unit/import-plan.test.ts` (signed or debit and credit columns, date orders, decimal comma, rejected rows with line and reason, duplicates skipped and counted, all or none); L2 import in the contract suite; L3 `tests/integration/import.test.ts` (2,000 rows through the real backend and file in under 5 s); L4 `tests/ui/import.spec.ts` (pick, detect, map, preview, rejected list, confirm, second import adds nothing); L5 tiers of the import screen; L6 `tests/e2e/import.spec.ts` (open-dialog bypass, import, re-import adds nothing, restart keeps them) | L0 to L6 | solo | open |
| 3 | Categories and rules | L1 `tests/unit/categories.test.ts` (create, rename, delete uncategorises, merge moves transactions and rules, rule matching); L2 category calls in the contract suite; L3 version 1 file opens as version 2 (`tests/integration/store.test.ts`); L4 `tests/ui/categories.spec.ts` (manage categories, assign in the form, rules on import and on request); L5 tiers of the categories screen | L0 to L5 | solo | open |
| 4 | Monthly summary and budgets | L1 `tests/unit/summary.test.ts` (per category, income against spending, left or over, month boundaries, generated mixes sum to the cent); L2 budget call in the contract suite; L3 version 2 file opens as version 3; L4 `tests/ui/summary.spec.ts` (month navigation, totals equal the transactions shown, budget left and over); L5 tiers of the summary screen; L6 the summary of a recorded transaction in `tests/e2e/record.spec.ts` | L0 to L6 | solo | open |
| 5 | Find, export, undo | L1 `tests/unit/filter.test.ts`, `tests/unit/csv-export.test.ts` (export imports back into an empty ledger as the same transactions), `tests/unit/undo.test.ts` (delete, merge, import undone once; any other change clears it); L2 undo in the contract suite; L4 `tests/ui/find.spec.ts` (search, filters, export download, undo); L5 tiers of the filtered list; L6 `tests/e2e/export.spec.ts` (save-dialog bypass, export, re-import into a fresh ledger gives the same transactions; undo an import) | L0 to L6 | solo | open |
| 6 | Release readiness | Version 0.1.0; `CHANGELOG.md`; release notes with the signing status; `.github/workflows/release.yml` with the gate job; ci and installers green on the release commit on all three runners; an independent bug hunt with every finding fixed (test seen red) or listed as a known defect; ledger rows for each. No tag, no GitHub release | L0 to L7 | solo | open |

## Rulings that apply to every slice

- Ruling: each slice that changes `contracts/` lands as two PRs: the contract PR (types, bridge channels, the core service, the mock, the contract suite green against the mock and the real backend) merges first, then the slice PR (UI, L4 to L6) — AGENTS.md rule 3 — cost if wrong: about five extra CI runs.
- Ruling: pixel baselines are captured by dispatching `snapshots` on the slice branch, which commits to that branch, not through a bot pull request on main — no repository permission change is needed — cost if wrong: none.
- Ruling: L3 runs on all three OSes in its own ci job — atomic rename behaves differently on Windows — cost if wrong: about a minute of runner time per push.
- Ruling: the slice PRs are stacked and merged in order with `[skip ci]` in the merge commit; each PR's own ci run on its merge ref is that slice's evidence, and main runs ci and installers on the release commit — the account's macOS runners were the bottleneck (jobs queued for up to an hour) — cost if wrong: an intermediate main commit has no run of its own.
- Ruling: a ledger-only commit added to a PR after its run went green carries `[skip ci]` — the tested code is unchanged — cost if wrong: none.

## Rulings by slice

Slice 1
- Ruling: the form takes an unsigned amount and a Spending or Income choice (default Spending); amounts are stored signed, spending negative — most entries are spending — cost if wrong: a form change.
- Ruling: an amount is a non-zero whole number of minor units, at most 1,000,000,000,000 in size; payee 1 to 200 characters after trimming and collapsing spaces; note up to 1,000 characters — cost if wrong: a limit to change.
- Ruling: currencies are a fixed ISO 4217 list with their minor-unit digits, default USD; the currency may change while the ledger is empty or to a currency with the same digits, so no stored amount changes value — cost if wrong: a person re-enters amounts.
- Ruling: until slice 3 creates categories the category select offers only "Uncategorised" — the slice order is fixed — cost if wrong: none.
- Ruling: transactions on the same date list the most recently added first — cost if wrong: a sort key.
- Ruling: a ledger file that does not parse or has a newer version is left untouched and the app refuses changes with a message naming the file — losing a ledger is the worst failure — cost if wrong: a person moves a damaged file by hand.

Slice 2
- Ruling: duplicates are matched count-aware: each existing transaction absorbs at most one identical row (date, amount, payee), so two identical rows in one file both import the first time and both skip the second — "twice adds nothing" holds and real statements repeat rows — cost if wrong: the strict reading drops a repeated row on the first import.
- Ruling: files are read as UTF-8 (BOM removed), falling back to Windows-1252 when the bytes are not valid UTF-8; files over 10 MB are refused — cost if wrong: other encodings show garbled payees.
- Ruling: an amount cell may have a sign, thousands separators, a currency symbol and spaces; the decimal separator (point or comma) is detected and can be changed; a debit column's value is spending and a credit column's is income, and a row with both or neither is rejected — cost if wrong: one more amount format.
- Ruling: rejected-row line numbers are 1-based lines of the file as a text editor shows them — cost if wrong: an off-by-one in a message.

Slice 3
- Ruling: category names are unique ignoring case, 1 to 60 characters; rules match payee text ignoring case, and when several match the oldest rule wins — cost if wrong: a rule order setting later.
- Ruling: deleting a category deletes its rules; merging moves its transactions and rules to the target, which keeps its own budget — cost if wrong: a rule to recreate.

Slice 4
- Ruling: one monthly budget per category, the same every month — the brief says "a monthly budget per category" — cost if wrong: per-month budgets need a file version.
- Ruling: a category's spending is minus its net total for the month, so refunds reduce it; left is budget minus spending; uncategorised has its own row and no budget; the summary opens on the current month — cost if wrong: a display change.

Slice 5
- Ruling: the amount range compares the absolute amount; "delete" for undo covers deleting a transaction and deleting a category — cost if wrong: a filter option later.
- Ruling: the export columns are Date, Payee, Amount, Category, Note; the import mapping gains optional Category and Note columns so the round trip keeps them, and a category name not in the ledger is created on confirm — cost if wrong: a round trip that drops categories.
- Ruling: exported cells are not escaped against spreadsheet formulas — escaping would change the round trip — cost if wrong: a payee starting with "=" is evaluated by a spreadsheet that opens the export.
