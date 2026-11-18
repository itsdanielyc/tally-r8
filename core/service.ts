// The one save pipeline. Every change to the ledger goes through commit():
// changes run one at a time, the new ledger is written by the store, and only
// after the write succeeds does it replace the ledger in memory. A refused or
// failed change leaves both the file and memory as they were.
//
// Undo: a delete, a merge or an import keeps the ledger from just before it,
// in memory. Undo puts that ledger back, once. Any other change, and a
// restart, forgets it.
//
// The main process runs this service on the ledger file (electron/store.ts);
// the labelled mock runs the very same service on memory (src/mock.ts).
import type { ImportMapping, ImportOutcome, LedgerApi, LedgerStatus, Result, RulesOutcome, Snapshot, TallyError, TransactionInput } from "../contracts/tally";
import * as categories from "./categories";
import { applyImport, checkMapping, planImport } from "./import-plan";
import { type Ledger, toSnapshot } from "./ledger";
import { setCurrency } from "./settings";
import { addTransaction, deleteTransaction, updateTransaction } from "./transactions";

export interface LedgerStore {
  /** Where the ledger lives, shown to the person. */
  readonly file: string;
  /** Writes the whole ledger; resolves only once it is safely stored. */
  save(ledger: Ledger): Promise<void>;
}

export type OpenedLedger = { ledger: Ledger; status: LedgerStatus };

/** A change returns the new ledger, or the same object when nothing changed. */
type Change = (ledger: Ledger) => Result<Ledger>;
/** Names an undoable change, from the ledger as it was before it. */
type Label = (before: Ledger) => string;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export class TallyService implements LedgerApi {
  private ledger: Ledger;
  private readonly status: LedgerStatus;
  private readonly store: LedgerStore;
  private queue: Promise<unknown> = Promise.resolve();
  private previous: { ledger: Ledger; label: string } | null = null;

  constructor(opened: OpenedLedger, store: LedgerStore) {
    this.ledger = opened.ledger;
    this.status = opened.status;
    this.store = store;
  }

  load(): Promise<Snapshot> {
    return this.enqueue(async () => this.snapshot());
  }

  addTransaction(input: TransactionInput): Promise<Result<Snapshot>> {
    return this.commit((ledger) => addTransaction(ledger, input));
  }

  updateTransaction(id: string, input: TransactionInput): Promise<Result<Snapshot>> {
    return this.commit((ledger) => updateTransaction(ledger, id, input));
  }

  deleteTransaction(id: string): Promise<Result<Snapshot>> {
    return this.commit((ledger) => deleteTransaction(ledger, id), (before) => {
      const t = before.transactions.find((x) => x.id === id);
      return `Deleted the transaction "${t?.payee ?? id}" of ${t?.date ?? "?"}`;
    });
  }

  setCurrency(code: string): Promise<Result<Snapshot>> {
    return this.commit((ledger) => setCurrency(ledger, code));
  }

  async importCsv(text: string, mapping: ImportMapping): Promise<Result<ImportOutcome>> {
    let counts = { added: 0, duplicates: 0, rejected: 0 };
    const result = await this.commit((ledger) => {
      const checked = checkMapping(mapping);
      if (!checked.ok) return checked;
      if (typeof text !== "string") return { ok: false, error: { code: "invalid", message: "The file text is missing." } };
      const plan = planImport(text, checked.value, ledger);
      if (!plan.ok) return plan;
      counts = { added: plan.value.rows.length, duplicates: plan.value.duplicates, rejected: plan.value.rejected.length };
      return { ok: true, value: applyImport(ledger, plan.value) };
    }, () => `Imported ${plural(counts.added, "transaction", "transactions")}`);
    return result.ok ? { ok: true, value: { snapshot: result.value, ...counts } } : result;
  }

  createCategory(name: string): Promise<Result<Snapshot>> {
    return this.commit((ledger) => categories.createCategory(ledger, name));
  }

  renameCategory(id: string, name: string): Promise<Result<Snapshot>> {
    return this.commit((ledger) => categories.renameCategory(ledger, id, name));
  }

  deleteCategory(id: string): Promise<Result<Snapshot>> {
    return this.commit((ledger) => categories.deleteCategory(ledger, id),
      (before) => `Deleted the category "${before.categories.find((c) => c.id === id)?.name ?? id}"`);
  }

  mergeCategories(fromId: string, intoId: string): Promise<Result<Snapshot>> {
    return this.commit((ledger) => categories.mergeCategories(ledger, fromId, intoId), (before) => {
      const name = (id: string) => before.categories.find((c) => c.id === id)?.name ?? id;
      return `Merged "${name(fromId)}" into "${name(intoId)}"`;
    });
  }

  createRule(contains: string, categoryId: string): Promise<Result<Snapshot>> {
    return this.commit((ledger) => categories.createRule(ledger, contains, categoryId));
  }

  deleteRule(id: string): Promise<Result<Snapshot>> {
    return this.commit((ledger) => categories.deleteRule(ledger, id));
  }

  setBudget(categoryId: string, amount: number | null): Promise<Result<Snapshot>> {
    return this.commit((ledger) => categories.setBudget(ledger, categoryId, amount));
  }

  async applyRules(): Promise<Result<RulesOutcome>> {
    let changed = 0;
    const result = await this.commit((ledger) => {
      const applied = categories.applyRules(ledger);
      changed = applied.changed;
      return { ok: true, value: applied.ledger };
    });
    return result.ok ? { ok: true, value: { snapshot: result.value, changed } } : result;
  }

  undo(): Promise<Result<Snapshot>> {
    return this.enqueue(async (): Promise<Result<Snapshot>> => {
      const refused = this.refusal();
      if (refused) return { ok: false, error: refused };
      const previous = this.previous;
      if (!previous) return { ok: false, error: { code: "not_found", message: "There is nothing to undo." } };
      // Ids are never handed out twice, even for transactions an undo removed.
      const restored: Ledger = { ...previous.ledger, nextId: Math.max(previous.ledger.nextId, this.ledger.nextId) };
      const failed = await this.save(restored);
      if (failed) return { ok: false, error: failed };
      this.previous = null;
      this.ledger = restored;
      return { ok: true, value: this.snapshot() };
    });
  }

  private snapshot(): Snapshot {
    return toSnapshot(this.ledger, this.status, this.store.file, this.previous?.label ?? null);
  }

  private refusal(): TallyError | null {
    if (this.status.kind === "ok") return null;
    return { code: "readonly", message: `The ledger was not opened, so nothing can change: ${this.status.message}` };
  }

  private async save(ledger: Ledger): Promise<TallyError | null> {
    try {
      await this.store.save(ledger);
      return null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { code: "io", message: `The ledger could not be saved, so the change was not made: ${detail}` };
    }
  }

  private commit(change: Change, label?: Label): Promise<Result<Snapshot>> {
    return this.enqueue(async (): Promise<Result<Snapshot>> => {
      const refused = this.refusal();
      if (refused) return { ok: false, error: refused };
      const before = this.ledger;
      const next = change(before);
      if (!next.ok) return next;
      // Nothing changed: nothing to save, and what can be undone stays as it was.
      if (next.value === before) return { ok: true, value: this.snapshot() };
      const failed = await this.save(next.value);
      if (failed) return { ok: false, error: failed };
      this.previous = label ? { ledger: before, label: label(before) } : null;
      this.ledger = next.value;
      return { ok: true, value: this.snapshot() };
    });
  }

  /** Runs tasks one after another, so two changes never interleave. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
