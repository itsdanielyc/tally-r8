// The Import screen: pick a bank's CSV, check the guessed mapping, see the
// first rows exactly as they will be imported and every row that cannot be
// read, then import all accepted rows together, or cancel.
import type { ImportOutcome } from "../../contracts/tally";
import { inspectCsv } from "../../core/csv-inspect";
import { planImport } from "../../core/import-plan";
import { currencyDigits, formatAmount } from "../../core/money";
import type { Ctx } from "../app";
import { h } from "../dom";
import { mappingForm, type PickedImport } from "./import-mapping";

export type ImportState = {
  file: PickedImport | null;
  result: { name: string; added: number; duplicates: number; rejected: number } | null;
  error?: string;
};

const PREVIEW_ROWS = 10;
const LISTED_REJECTIONS = 50;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function pick(ctx: Ctx): Promise<void> {
  const r = await ctx.backend.pickCsvFile();
  if (!r.ok) {
    ctx.ui.importing = { file: null, result: null, error: r.error.message };
  } else if (r.value) {
    const inspection = inspectCsv(r.value.text);
    ctx.ui.importing = { file: { name: r.value.name, text: r.value.text, inspection, mapping: inspection.mapping }, result: null };
  }
  ctx.render();
}

async function confirm(ctx: Ctx, file: PickedImport): Promise<void> {
  const r = await ctx.backend.importCsv(file.text, file.mapping);
  if (!r.ok) {
    ctx.ui.importing = { ...ctx.ui.importing, error: r.error.message };
    ctx.render();
    return;
  }
  const done: ImportOutcome = r.value;
  ctx.ui.importing = { file: null, result: { name: file.name, added: done.added, duplicates: done.duplicates, rejected: done.rejected } };
  ctx.apply({ ok: true, value: done.snapshot });
}

function startPanel(ctx: Ctx): HTMLElement {
  const { result, error } = ctx.ui.importing;
  return h("div", { class: "panel import-start", "data-geo": "import-start" },
    result && h("p", { class: "import-result", role: "status" },
      `Imported ${plural(result.added, "transaction", "transactions")} from ${result.name}. `,
      `${plural(result.duplicates, "row was", "rows were")} already in the ledger and skipped; `,
      `${plural(result.rejected, "row", "rows")} could not be read.`),
    error && h("p", { class: "form-error", role: "alert" }, error),
    h("p", { class: "hint" }, "Choose the CSV file your bank exports. Nothing is added until you confirm the preview."),
    h("button", { type: "button", class: "primary", disabled: ctx.snapshot.status.kind !== "ok", onclick: () => void pick(ctx) }, "Choose a CSV file…"),
  );
}

function previewTable(ctx: Ctx, rows: { line: number; date: string; payee: string; amount: number; categoryId: string | null; newCategory: string | null }[]): HTMLElement {
  const digits = currencyDigits(ctx.snapshot.settings.currency);
  const category = (id: string | null) => ctx.snapshot.categories.find((c) => c.id === id)?.name;
  return h("table", { class: "ledger preview", "aria-label": "Preview", "data-geo": "preview" },
    h("thead", {}, h("tr", {},
      h("th", { scope: "col", class: "line" }, "Line"),
      h("th", { scope: "col", class: "date" }, "Date"),
      h("th", { scope: "col" }, "Payee"),
      h("th", { scope: "col" }, "Category"),
      h("th", { scope: "col", class: "amount" }, `Amount (${ctx.snapshot.settings.currency})`))),
    h("tbody", {}, ...rows.map((r) => h("tr", {},
      h("td", { class: "line" }, String(r.line)),
      h("td", { class: "date" }, r.date),
      h("td", { class: "payee", title: r.payee }, r.payee),
      r.newCategory !== null
        ? h("td", { class: "category" }, `${r.newCategory} (new)`)
        : h("td", { class: category(r.categoryId) ? "category" : "category none" }, category(r.categoryId) ?? "Uncategorised"),
      h("td", { class: r.amount > 0 ? "amount income" : "amount spending" }, (r.amount > 0 ? "+" : "") + formatAmount(r.amount, digits))))),
  );
}

function rejectedList(rejected: { line: number; reason: string }[]): HTMLElement | null {
  if (rejected.length === 0) return null;
  const more = rejected.length - LISTED_REJECTIONS;
  return h("section", { class: "rejected", "aria-labelledby": "rejected-title" },
    h("h2", { id: "rejected-title" }, "Rows that cannot be read"),
    h("ul", {}, ...rejected.slice(0, LISTED_REJECTIONS).map((r) => h("li", {}, `Line ${r.line}: ${r.reason}`))),
    more > 0 && h("p", { class: "hint" }, `…and ${more} more.`),
  );
}

function reviewPanel(ctx: Ctx, file: PickedImport): HTMLElement[] {
  const update = (next: PickedImport) => {
    ctx.ui.importing = { file: next, result: null };
    ctx.render();
  };
  const plan = planImport(file.text, file.mapping, ctx.snapshot);
  const cancel = () => {
    ctx.ui.importing = { file: null, result: null };
    ctx.render();
  };
  if (!plan.ok) return [mappingForm(file, update), h("p", { class: "form-error", role: "alert" }, plan.error.message)];
  const { rows, duplicates, rejected } = plan.value;
  return [
    h("div", { class: "import-file" },
      h("strong", {}, file.name),
      h("button", { type: "button", class: "quiet", onclick: () => void pick(ctx) }, "Choose another file…")),
    mappingForm(file, update),
    h("p", { class: "import-summary", "data-testid": "import-summary" },
      `${plural(rows.length, "row", "rows")} will be imported · ${duplicates} already in the ledger · ${rejected.length} cannot be read`),
    rows.length > 0 ? previewTable(ctx, rows.slice(0, PREVIEW_ROWS)) : null,
    rejectedList(rejected),
    ctx.ui.importing.error ? h("p", { class: "form-error", role: "alert" }, ctx.ui.importing.error) : null,
    h("div", { class: "import-actions" },
      h("button", { type: "button", class: "primary", disabled: rows.length === 0, onclick: () => void confirm(ctx, file) },
        `Import ${plural(rows.length, "transaction", "transactions")}`),
      h("button", { type: "button", onclick: cancel }, "Cancel")),
  ].filter((el): el is HTMLElement => el !== null);
}

export function importView(ctx: Ctx): HTMLElement {
  const file = ctx.ui.importing.file;
  return h("section", { class: "view", "aria-labelledby": "view-title" },
    h("header", { class: "view-head" }, h("h1", { id: "view-title" }, "Import a bank CSV")),
    ...(file ? reviewPanel(ctx, file) : [startPanel(ctx)]),
  );
}
