// The contract between the UI and the backend. The main process (through the
// preload bridge) and the labelled mock both implement TallyApi from these
// types; the contract suite (tests/contract) runs the same calls against both,
// and the real-shell suite (tests/e2e) makes them through real IPC.
//
// Money is always a whole number of minor units (cents for USD): spending is
// negative, income positive. Dates are calendar dates, "YYYY-MM-DD".

export type Transaction = {
  id: string;
  date: string;
  payee: string;
  amount: number;
  categoryId: string | null;
  note: string;
};

/** What the person types: a transaction without its id. */
export type TransactionInput = Omit<Transaction, "id">;

export type Category = {
  id: string;
  name: string;
};

/** "Payee contains this text, use this category". Matching ignores case. */
export type Rule = {
  id: string;
  contains: string;
  categoryId: string;
};

export type Settings = {
  /** ISO 4217 code; its minor-unit digits come from core/money.ts. */
  currency: string;
};

/**
 * "ok", or why the ledger file could not be opened. When it is not "ok" the
 * file is left untouched and every change is refused.
 */
export type LedgerStatus =
  | { kind: "ok" }
  | { kind: "unreadable" | "newer"; message: string };

/** The whole ledger as the UI sees it. Transactions are newest first. */
export type Snapshot = {
  status: LedgerStatus;
  /** Where the ledger lives: a file path, or "memory" for the mock. */
  file: string;
  settings: Settings;
  transactions: Transaction[];
  /** Sorted by name, ignoring case. */
  categories: Category[];
  /** In the order they were made; when several match, the first wins. */
  rules: Rule[];
};

type TallyErrorCode = "invalid" | "not_found" | "readonly" | "io";

export type TallyError = {
  code: TallyErrorCode;
  message: string;
  /** For "invalid": the input field at fault, when there is one. */
  field?: string;
};

/** Errors are values, never exceptions, so they cross IPC unchanged. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: TallyError };

export type Delimiter = "," | ";" | "\t" | "|";
export type DateOrder = "YMD" | "DMY" | "MDY";

/** How the columns of a bank CSV become transactions. Columns count from 0. */
export type ImportMapping = {
  delimiter: Delimiter;
  /** Index of the header record among the parsed records, or null for none. */
  headerRow: number | null;
  date: number;
  payee: number;
  amount: { kind: "signed"; column: number } | { kind: "split"; debit: number; credit: number };
  dateOrder: DateOrder;
  decimal: "." | ",";
};

/** A CSV file the person picked, already decoded to text. */
export type PickedFile = { name: string; text: string };

export type ImportOutcome = {
  snapshot: Snapshot;
  added: number;
  /** Rows identical (date, amount, payee) to a transaction already there. */
  duplicates: number;
  rejected: number;
};

export type RulesOutcome = { snapshot: Snapshot; changed: number };

/** Everything the ledger service answers, in the main process and in the mock. */
export interface LedgerApi {
  load(): Promise<Snapshot>;
  addTransaction(input: TransactionInput): Promise<Result<Snapshot>>;
  updateTransaction(id: string, input: TransactionInput): Promise<Result<Snapshot>>;
  deleteTransaction(id: string): Promise<Result<Snapshot>>;
  setCurrency(code: string): Promise<Result<Snapshot>>;
  createCategory(name: string): Promise<Result<Snapshot>>;
  renameCategory(id: string, name: string): Promise<Result<Snapshot>>;
  /** Its transactions become uncategorised; its rules go with it. */
  deleteCategory(id: string): Promise<Result<Snapshot>>;
  /** Moves every transaction and rule of `fromId` to `intoId`, then removes `fromId`. */
  mergeCategories(fromId: string, intoId: string): Promise<Result<Snapshot>>;
  createRule(contains: string, categoryId: string): Promise<Result<Snapshot>>;
  deleteRule(id: string): Promise<Result<Snapshot>>;
  /** Applies the rules to every uncategorised transaction. */
  applyRules(): Promise<Result<RulesOutcome>>;
  /** Imports every accepted row together, or none. Rules categorise the rows. */
  importCsv(text: string, mapping: ImportMapping): Promise<Result<ImportOutcome>>;
}

/** The ledger plus what only the platform can do: file dialogs. */
export interface TallyApi extends LedgerApi {
  /** Asks for a CSV file; ok with null when the person cancels. */
  pickCsvFile(): Promise<Result<PickedFile | null>>;
}
