// The Transactions screen: the entry form, then every transaction, newest
// first. Edit puts a row into the form; Delete asks in the row itself.
import type { Transaction } from "../../contracts/tally";
import { exportCsv } from "../../core/csv-export";
import { localIsoDate } from "../../core/dates";
import { applyFilter, isFiltered } from "../../core/filter";
import { currencyDigits, formatAmount } from "../../core/money";
import type { Ctx } from "../app";
import { h, replace } from "../dom";
import { filterBar } from "./filter-bar";
import { transactionForm } from "./transaction-form";

function signed(amount: number, digits: number): string {
  return amount > 0 ? `+${formatAmount(amount, digits)}` : formatAmount(amount, digits);
}

function rowActions(ctx: Ctx, t: Transaction): HTMLElement {
  const set = (patch: Partial<Ctx["ui"]>) => {
    Object.assign(ctx.ui, patch);
    ctx.render();
  };
  if (ctx.ui.confirmDeleteId === t.id) {
    const confirm = async () => {
      ctx.ui.confirmDeleteId = null;
      if (ctx.ui.editingId === t.id) ctx.ui.editingId = null;
      const error = ctx.apply(await ctx.backend.deleteTransaction(t.id));
      if (error) set({});
    };
    return h("td", { class: "actions confirm" },
      h("span", { class: "visually-hidden" }, "Delete this transaction?"),
      h("button", { type: "button", class: "danger", onclick: () => void confirm() }, "Yes, delete"),
      h("button", { type: "button", onclick: () => set({ confirmDeleteId: null }) }, "Keep"),
    );
  }
  const readonly = ctx.snapshot.status.kind !== "ok";
  return h("td", { class: "actions" },
    h("button", { type: "button", class: "quiet", disabled: readonly, onclick: () => set({ editingId: t.id, confirmDeleteId: null, focus: "entry-amount" }) }, "Edit"),
    h("button", { type: "button", class: "quiet", disabled: readonly, onclick: () => set({ confirmDeleteId: t.id }) }, "Delete"),
  );
}

function row(ctx: Ctx, t: Transaction, digits: number): HTMLElement {
  const category = ctx.snapshot.categories.find((c) => c.id === t.categoryId);
  const state = ctx.ui.confirmDeleteId === t.id ? "confirming" : ctx.ui.editingId === t.id ? "editing" : false;
  return h("tr", { "data-id": t.id, class: state },
    h("td", { class: "date" }, t.date),
    h("td", { class: "payee", title: t.payee }, t.payee),
    h("td", { class: category ? "category" : "category none" }, category ? category.name : "Uncategorised"),
    h("td", { class: "note", title: t.note || false }, t.note),
    h("td", { class: t.amount > 0 ? "amount income" : "amount spending" }, signed(t.amount, digits)),
    rowActions(ctx, t),
  );
}

function ledgerTable(ctx: Ctx, shown: Transaction[]): HTMLElement {
  const digits = currencyDigits(ctx.snapshot.settings.currency);
  return h("table", { class: "ledger", "aria-label": "Transactions", "data-geo": "ledger" },
    h("thead", {}, h("tr", {},
      h("th", { scope: "col", class: "date" }, "Date"),
      h("th", { scope: "col" }, "Payee"),
      h("th", { scope: "col" }, "Category"),
      h("th", { scope: "col" }, "Note"),
      h("th", { scope: "col", class: "amount" }, `Amount (${ctx.snapshot.settings.currency})`),
      h("th", { scope: "col", class: "actions" }, h("span", { class: "visually-hidden" }, "Actions")),
    )),
    h("tbody", {}, ...shown.map((t) => row(ctx, t, digits))),
  );
}

async function exportShown(ctx: Ctx, shown: Transaction[], message: HTMLElement): Promise<void> {
  const csv = exportCsv(shown, ctx.snapshot.categories, ctx.snapshot.settings.currency);
  const r = await ctx.backend.saveCsvFile(`tally-${localIsoDate(new Date())}.csv`, csv);
  if (!r.ok) message.textContent = r.error.message;
  else if (r.value !== null) message.textContent = `Exported ${shown.length} ${shown.length === 1 ? "transaction" : "transactions"} to ${r.value}.`;
}

/** The part of the screen a filter change redraws: what is shown, the export button, the table. */
function listContent(ctx: Ctx): (HTMLElement | null)[] {
  const all = ctx.snapshot.transactions;
  if (all.length === 0) return [h("p", { class: "empty", "data-geo": "empty" }, "No transactions yet. Add the first one above, or import a bank CSV.")];
  const { shown, problems } = applyFilter(all, ctx.ui.filter, currencyDigits(ctx.snapshot.settings.currency));
  const message = h("span", { class: "export-message", role: "status" });
  return [
    h("div", { class: "list-bar" },
      h("span", { "data-testid": "shown" }, isFiltered(ctx.ui.filter) ? `Showing ${shown.length} of ${all.length}` : `Showing all ${all.length}`),
      message,
      h("button", { type: "button", disabled: shown.length === 0, onclick: () => void exportShown(ctx, shown, message) }, "Export shown to CSV")),
    problems.length ? h("p", { class: "form-error", role: "alert" }, problems.join(" ")) : null,
    shown.length > 0 ? ledgerTable(ctx, shown) : h("p", { class: "empty" }, "No transactions match the filter."),
  ];
}

export function transactionsView(ctx: Ctx): HTMLElement {
  const count = ctx.snapshot.transactions.length;
  const list = h("div", { class: "list-area" });
  const drawList = () => replace(list, ...listContent(ctx));
  drawList();
  return h("section", { class: "view", "aria-labelledby": "view-title" },
    h("header", { class: "view-head" },
      h("h1", { id: "view-title" }, "Transactions"),
      h("p", { class: "count", "data-testid": "count" }, `${count} ${count === 1 ? "transaction" : "transactions"}`),
    ),
    transactionForm(ctx),
    count > 0 ? filterBar(ctx, drawList) : null,
    list,
  );
}
