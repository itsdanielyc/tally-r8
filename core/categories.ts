// Categories and payee rules. A category name is unique ignoring case. A rule
// says "payee contains this text, use this category"; matching ignores case,
// and when several rules match, the oldest one wins.
import type { Category, Result, Rule, TallyError, Transaction } from "../contracts/tally";
import type { Ledger } from "./ledger";
import { MAX_AMOUNT } from "./money";
import { cleanText } from "./transactions";

const CATEGORY_NAME_MAX = 60;
const RULE_TEXT_MAX = 100;

const fail = (code: TallyError["code"], message: string, field?: string): { ok: false; error: TallyError } =>
  ({ ok: false, error: field ? { code, message, field } : { code, message } });

function checkName(ledger: Ledger, raw: unknown, except?: string): Result<string> {
  const name = typeof raw === "string" ? cleanText(raw) : "";
  if (name === "") return fail("invalid", "A category needs a name.", "name");
  if (name.length > CATEGORY_NAME_MAX) return fail("invalid", `A category name can be at most ${CATEGORY_NAME_MAX} characters.`, "name");
  const taken = ledger.categories.some((c) => c.id !== except && c.name.toLowerCase() === name.toLowerCase());
  if (taken) return fail("invalid", `There is already a category called "${name}".`, "name");
  return { ok: true, value: name };
}

function find(ledger: Ledger, id: unknown): Category | undefined {
  return ledger.categories.find((c) => c.id === id);
}

const noCategory = (id: unknown) => fail("not_found", `No category with id ${String(id)}.`);

export function createCategory(ledger: Ledger, name: unknown): Result<Ledger> {
  const checked = checkName(ledger, name);
  if (!checked.ok) return checked;
  const category: Category = { id: `c${ledger.nextId}`, name: checked.value, budget: null };
  return { ok: true, value: { ...ledger, categories: [...ledger.categories, category], nextId: ledger.nextId + 1 } };
}

export function renameCategory(ledger: Ledger, id: unknown, name: unknown): Result<Ledger> {
  if (!find(ledger, id)) return noCategory(id);
  const checked = checkName(ledger, name, id as string);
  if (!checked.ok) return checked;
  return { ok: true, value: { ...ledger, categories: ledger.categories.map((c) => (c.id === id ? { ...c, name: checked.value } : c)) } };
}

export function deleteCategory(ledger: Ledger, id: unknown): Result<Ledger> {
  if (!find(ledger, id)) return noCategory(id);
  return {
    ok: true,
    value: {
      ...ledger,
      categories: ledger.categories.filter((c) => c.id !== id),
      rules: ledger.rules.filter((r) => r.categoryId !== id),
      transactions: ledger.transactions.map((t) => (t.categoryId === id ? { ...t, categoryId: null } : t)),
    },
  };
}

const sameRule = (a: Rule, b: Rule) => a.categoryId === b.categoryId && a.contains.toLowerCase() === b.contains.toLowerCase();

export function mergeCategories(ledger: Ledger, fromId: unknown, intoId: unknown): Result<Ledger> {
  if (!find(ledger, fromId)) return noCategory(fromId);
  if (!find(ledger, intoId)) return noCategory(intoId);
  if (fromId === intoId) return fail("invalid", "A category cannot be merged into itself.", "into");
  const rules: Rule[] = [];
  for (const r of ledger.rules) {
    const moved = r.categoryId === fromId ? { ...r, categoryId: intoId as string } : r;
    if (!rules.some((kept) => sameRule(kept, moved))) rules.push(moved);
  }
  return {
    ok: true,
    value: {
      ...ledger,
      categories: ledger.categories.filter((c) => c.id !== fromId),
      rules,
      transactions: ledger.transactions.map((t) => (t.categoryId === fromId ? { ...t, categoryId: intoId as string } : t)),
    },
  };
}

export function createRule(ledger: Ledger, contains: unknown, categoryId: unknown): Result<Ledger> {
  const text = typeof contains === "string" ? cleanText(contains) : "";
  if (text === "") return fail("invalid", "A rule needs the text a payee contains.", "contains");
  if (text.length > RULE_TEXT_MAX) return fail("invalid", `A rule's text can be at most ${RULE_TEXT_MAX} characters.`, "contains");
  if (!find(ledger, categoryId)) return fail("invalid", "Choose the category the rule uses.", "categoryId");
  const rule: Rule = { id: `r${ledger.nextId}`, contains: text, categoryId: categoryId as string };
  if (ledger.rules.some((r) => sameRule(r, rule))) return fail("invalid", "That rule already exists.", "contains");
  return { ok: true, value: { ...ledger, rules: [...ledger.rules, rule], nextId: ledger.nextId + 1 } };
}

export function deleteRule(ledger: Ledger, id: unknown): Result<Ledger> {
  if (!ledger.rules.some((r) => r.id === id)) return fail("not_found", `No rule with id ${String(id)}.`);
  return { ok: true, value: { ...ledger, rules: ledger.rules.filter((r) => r.id !== id) } };
}

/** A monthly budget: a positive whole number of minor units, or null for none. */
export function setBudget(ledger: Ledger, id: unknown, amount: unknown): Result<Ledger> {
  if (!find(ledger, id)) return noCategory(id);
  const valid = amount === null || (typeof amount === "number" && Number.isInteger(amount) && amount > 0 && amount <= MAX_AMOUNT);
  if (!valid) return fail("invalid", "A budget must be more than zero, in whole minor units.", "budget");
  return { ok: true, value: { ...ledger, categories: ledger.categories.map((c) => (c.id === id ? { ...c, budget: amount } : c)) } };
}

/** The category of the oldest rule whose text the payee contains, ignoring case. */
export function matchRule(rules: Rule[], payee: string): string | null {
  const lower = payee.toLowerCase();
  return rules.find((r) => lower.includes(r.contains.toLowerCase()))?.categoryId ?? null;
}

/** Gives every uncategorised transaction its rule's category; counts the changes. */
export function applyRules(ledger: Ledger): { ledger: Ledger; changed: number } {
  let changed = 0;
  const transactions = ledger.transactions.map((t): Transaction => {
    if (t.categoryId !== null) return t;
    const categoryId = matchRule(ledger.rules, t.payee);
    if (categoryId === null) return t;
    changed++;
    return { ...t, categoryId };
  });
  return { ledger: changed ? { ...ledger, transactions } : ledger, changed };
}
