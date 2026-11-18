// Adding, editing and deleting transactions, and the rules a transaction must
// meet. Inputs arrive from the renderer, so they are checked field by field as
// unknown values, never trusted for their declared type.
import type { Result, TallyError, Transaction, TransactionInput } from "../contracts/tally";
import { isValidIsoDate } from "./dates";
import type { Ledger } from "./ledger";
import { currencyDigits, formatAmount, MAX_AMOUNT } from "./money";

export const PAYEE_MAX = 200;
export const NOTE_MAX = 1000;

function invalid(field: string, message: string): { ok: false; error: TallyError } {
  return { ok: false, error: { code: "invalid", field, message } };
}

/** Trims and collapses runs of spaces, so "  Corner   shop " is "Corner shop". */
export function cleanText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function field(input: unknown, key: string): unknown {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>)[key] : undefined;
}

type Rules = Pick<Ledger, "settings" | "categories">;

function checkAmount(amount: unknown, ledger: Rules): string | null {
  if (typeof amount !== "number" || !Number.isInteger(amount)) return "Amount must be a whole number of minor units.";
  if (amount === 0) return "Amount cannot be zero.";
  if (Math.abs(amount) > MAX_AMOUNT) {
    const digits = currencyDigits(ledger.settings.currency);
    return `Amount cannot be larger than ${formatAmount(MAX_AMOUNT, digits)}.`;
  }
  return null;
}

function checkCategory(categoryId: unknown, ledger: Rules): string | null {
  if (categoryId === null) return null;
  if (typeof categoryId !== "string" || !ledger.categories.some((c) => c.id === categoryId)) {
    return "That category does not exist.";
  }
  return null;
}

/** Checks every field and returns the cleaned input, or the first problem. */
export function validateInput(input: unknown, ledger: Rules): Result<TransactionInput> {
  const date = field(input, "date");
  if (typeof date !== "string" || !isValidIsoDate(date)) return invalid("date", "Date must be a real day, as YYYY-MM-DD.");
  const rawPayee = field(input, "payee");
  const payee = typeof rawPayee === "string" ? cleanText(rawPayee) : "";
  if (payee === "") return invalid("payee", "Payee cannot be empty.");
  if (payee.length > PAYEE_MAX) return invalid("payee", `Payee can be at most ${PAYEE_MAX} characters.`);
  const amount = field(input, "amount");
  const amountProblem = checkAmount(amount, ledger);
  if (amountProblem) return invalid("amount", amountProblem);
  const categoryId = field(input, "categoryId") ?? null;
  const categoryProblem = checkCategory(categoryId, ledger);
  if (categoryProblem) return invalid("categoryId", categoryProblem);
  const rawNote = field(input, "note") ?? "";
  if (typeof rawNote !== "string") return invalid("note", "Note must be text.");
  const note = rawNote.trim();
  if (note.length > NOTE_MAX) return invalid("note", `Note can be at most ${NOTE_MAX} characters.`);
  return { ok: true, value: { date, payee, amount: amount as number, categoryId: categoryId as string | null, note } };
}

function notFound(id: unknown): { ok: false; error: TallyError } {
  return { ok: false, error: { code: "not_found", message: `No transaction with id ${String(id)}.` } };
}

export function addTransaction(ledger: Ledger, input: unknown): Result<Ledger> {
  const checked = validateInput(input, ledger);
  if (!checked.ok) return checked;
  const transaction: Transaction = { id: `t${ledger.nextId}`, ...checked.value };
  return { ok: true, value: { ...ledger, transactions: [...ledger.transactions, transaction], nextId: ledger.nextId + 1 } };
}

export function updateTransaction(ledger: Ledger, id: unknown, input: unknown): Result<Ledger> {
  const index = ledger.transactions.findIndex((t) => t.id === id);
  if (index < 0) return notFound(id);
  const checked = validateInput(input, ledger);
  if (!checked.ok) return checked;
  const transactions = [...ledger.transactions];
  transactions[index] = { id: transactions[index].id, ...checked.value };
  return { ok: true, value: { ...ledger, transactions } };
}

export function deleteTransaction(ledger: Ledger, id: unknown): Result<Ledger> {
  if (!ledger.transactions.some((t) => t.id === id)) return notFound(id);
  return { ok: true, value: { ...ledger, transactions: ledger.transactions.filter((t) => t.id !== id) } };
}
