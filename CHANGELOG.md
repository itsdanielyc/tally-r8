# Changelog

All notable changes to Tally. The format follows Keep a Changelog; versions
follow semantic versioning (0.x until the first outside user).

## [0.1.0] - not yet tagged

The first version: a desktop expense ledger for Windows x64, macOS Apple
silicon and Linux x64, in one local file.

### Added

- Record transactions: add, edit and delete a transaction with a date,
  payee, amount, optional category and optional note. The list shows the
  newest first. Amounts are whole cents (minor units) in the one currency
  chosen in Settings.
- One ledger file in the application data folder, versioned, written so that
  a crash or power cut during a save leaves the old ledger or the new one,
  never a broken one. A file Tally cannot read, or one a newer Tally wrote, is
  left untouched and shown as such.
- Import a bank CSV: the delimiter and header row are found for you; map the
  date, payee and amount (one signed column, or debit and credit columns),
  the date order and the decimal separator, plus optional category and note
  columns. The preview shows the rows as they will be imported and lists
  every row that cannot be read with its line number and the reason. Rows
  already in the ledger are skipped and counted. Everything is imported
  together, or nothing.
- Categories: create, rename, delete (its transactions become
  uncategorised) and merge. Payee rules ("payee contains this text, use this
  category") apply to imported rows and, on request, to every uncategorised
  transaction.
- A monthly summary: income against spending, the total per category, and a
  monthly budget per category with the amount left or over. Move between
  months.
- Find transactions by payee or note text, category, date range and amount
  range; export the transactions shown to a CSV that Tally imports back as
  the same transactions.
- Undo the most recent delete, category merge or import, once.

### Fixed before release (independent bug hunt)

- A bank CSV with a quote that never closes no longer hides every row after
  it; only that row is listed as unreadable.
- Every unreadable row is listed, not only the first 50.
- A "Value date" column is no longer taken for the amount.
- Amounts written as "(12.34)", "12.34 DR" or "12.34 CR", and "1500.00" in a
  currency without cents, are read.
- In a currency with three decimals, an amount such as "1,500" that reads
  two ways is refused instead of guessed.
- Spaces between a comma and a quoted field no longer split the field.
- Saving an edit that changes nothing no longer forgets what can be undone.
- A delete that cannot be saved now says so.
- A category filter is dropped when its category is merged or deleted.
- Renaming a category after a refused name no longer reopens the editor.
- A double click on Add or Import no longer adds the transactions twice.
- Dates are no longer cut off in the lists with the Linux and macOS system fonts.

### Pull requests

In merge order: #1 plan; #2, #3 scaffold and its baselines; #4, #7 record
transactions; #8, #10 import a bank CSV; #11, #12 categories and rules; #13, #5
monthly summary and budgets; #9, #6 find, export, undo; #14 bug-hunt fixes;
#15 release readiness.

### Known defects

See `docs/release-notes-0.1.0.md`: UTF-16 CSVs are not read; a data folder
that cannot be created makes Tally quit without a message.
