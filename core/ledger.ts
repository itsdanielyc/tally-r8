// The ledger as it is held in memory and written to the file. Pure data: the
// service decides when it changes, the store decides how it is written.
import type { Category, LedgerStatus, Settings, Snapshot, Transaction } from "../contracts/tally";
import { DEFAULT_CURRENCY } from "./money";

/** The file version this build writes. Older versions are migrated on open. */
export const LEDGER_VERSION = 1;

export type Ledger = {
  version: number;
  settings: Settings;
  /** In the order they were added; ids carry that order. */
  transactions: Transaction[];
  categories: Category[];
  /** The next number to use in an id; ids are never reused. */
  nextId: number;
};

export function emptyLedger(): Ledger {
  return {
    version: LEDGER_VERSION,
    settings: { currency: DEFAULT_CURRENCY },
    transactions: [],
    categories: [],
    nextId: 1,
  };
}

/** Reads the creation number back out of an id such as "t42". */
function idNumber(id: string): number {
  return Number(id.slice(1)) || 0;
}

/** Newest date first; on the same date, the most recently added first. */
function newestFirst(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return idNumber(b.id) - idNumber(a.id);
}

export function toSnapshot(ledger: Ledger, status: LedgerStatus, file: string): Snapshot {
  return {
    status,
    file,
    settings: { ...ledger.settings },
    transactions: ledger.transactions.map((t) => ({ ...t })).sort(newestFirst),
    categories: ledger.categories.map((c) => ({ ...c })),
  };
}
