// Reads a parsed ledger file of any version this build knows and brings it up
// to the current version. Every version that was ever written stays readable:
// each step turns version n into n + 1, and each has an L3 test with a
// fixture file of version n. A file from a newer Tally is never guessed at.
import type { Category, Rule, Transaction } from "../contracts/tally";
import { LEDGER_VERSION, type Ledger } from "../core/ledger";

export type Migrated =
  | { ok: true; ledger: Ledger }
  | { ok: false; kind: "unreadable" | "newer"; message: string };

type Doc = Record<string, unknown>;

const isObject = (v: unknown): v is Doc => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

function isTransaction(v: unknown): v is Transaction {
  return isObject(v) && typeof v.id === "string" && typeof v.date === "string" && typeof v.payee === "string" &&
    isInt(v.amount) && (v.categoryId === null || typeof v.categoryId === "string") && typeof v.note === "string";
}

function isCategory(v: unknown): v is Category {
  return isObject(v) && typeof v.id === "string" && typeof v.name === "string";
}

function isRule(v: unknown): v is Rule {
  return isObject(v) && typeof v.id === "string" && typeof v.contains === "string" && typeof v.categoryId === "string";
}

// Version n -> n + 1.
const STEPS: Record<number, (doc: Doc) => Doc> = {
  // 2 (slice 3) adds payee rules.
  1: (doc) => ({ ...doc, version: 2, rules: [] }),
};

function idNumber(id: string): number {
  return Number(id.slice(1)) || 0;
}

/** The current version's shape, checked field by field. */
function toLedger(doc: Doc): Ledger | null {
  const { settings, transactions, categories, rules, nextId } = doc;
  if (!isObject(settings) || typeof settings.currency !== "string") return null;
  if (!Array.isArray(transactions) || !transactions.every(isTransaction)) return null;
  if (!Array.isArray(categories) || !categories.every(isCategory)) return null;
  if (!Array.isArray(rules) || !rules.every(isRule)) return null;
  if (!isInt(nextId) || nextId < 1) return null;
  // Never hand out an id that is already taken, whatever nextId says.
  let highest = 0;
  for (const item of [...transactions, ...categories, ...rules]) highest = Math.max(highest, idNumber(item.id));
  return {
    version: LEDGER_VERSION,
    settings: { currency: settings.currency },
    transactions,
    categories,
    rules,
    nextId: Math.max(nextId, highest + 1),
  };
}

export function migrate(raw: unknown): Migrated {
  if (!isObject(raw) || !isInt(raw.version) || raw.version < 1) {
    return { ok: false, kind: "unreadable", message: "The file is not a Tally ledger (no version number)." };
  }
  if (raw.version > LEDGER_VERSION) {
    return { ok: false, kind: "newer", message: `The file was written by a newer Tally (ledger version ${raw.version}; this Tally reads up to ${LEDGER_VERSION}).` };
  }
  let doc: Doc = raw;
  for (let v = raw.version; v < LEDGER_VERSION; v++) doc = STEPS[v](doc);
  const ledger = toLedger(doc);
  if (!ledger) return { ok: false, kind: "unreadable", message: `The file says it is ledger version ${raw.version} but its contents do not match.` };
  return { ok: true, ledger };
}
