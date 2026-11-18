// The Transactions screen: the entry form, then every transaction, newest
// first. Edit puts a row into the form; Delete asks in the row itself.
import type { Transaction } from "../../contracts/tally";
import { currencyDigits, formatAmount } from "../../core/money";
import type { Ctx } from "../app";
import { h } from "../dom";
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

function ledgerTable(ctx: Ctx): HTMLElement {
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
    h("tbody", {}, ...ctx.snapshot.transactions.map((t) => row(ctx, t, digits))),
  );
}

export function transactionsView(ctx: Ctx): HTMLElement {
  const count = ctx.snapshot.transactions.length;
  return h("section", { class: "view", "aria-labelledby": "view-title" },
    h("header", { class: "view-head" },
      h("h1", { id: "view-title" }, "Transactions"),
      h("p", { class: "count", "data-testid": "count" }, `${count} ${count === 1 ? "transaction" : "transactions"}`),
    ),
    transactionForm(ctx),
    count > 0 ? ledgerTable(ctx) : h("p", { class: "empty", "data-geo": "empty" }, "No transactions yet. Add the first one above, or import a bank CSV."),
  );
}
