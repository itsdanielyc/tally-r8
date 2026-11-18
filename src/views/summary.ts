// The Summary screen: one month at a time. Income against spending, the
// total per category with its budget and what is left or over, and the
// month's transactions, whose sum is the net shown at the top.
import { currencyDigits, formatAmount } from "../../core/money";
import { addMonths, monthLabel, monthSummary, type MonthSummary } from "../../core/summary";
import type { Ctx } from "../app";
import { h } from "../dom";
import { budgetCell } from "./budget";

const signed = (n: number, digits: number) => (n > 0 ? `+${formatAmount(n, digits)}` : formatAmount(n, digits));

function monthNav(ctx: Ctx): HTMLElement {
  const go = (delta: number) => {
    ctx.ui.month = addMonths(ctx.ui.month, delta);
    ctx.ui.budgetEditId = null;
    ctx.render();
  };
  return h("div", { class: "month-nav", "data-geo": "month-nav" },
    h("button", { type: "button", onclick: () => go(-1) }, "‹ Previous month"),
    h("h2", { id: "month-label", "aria-live": "polite" }, monthLabel(ctx.ui.month)),
    h("button", { type: "button", onclick: () => go(1) }, "Next month ›"));
}

function stat(label: string, value: string, cls: string): HTMLElement {
  return h("div", { class: `stat ${cls}` }, h("span", { class: "stat-label" }, label), h("strong", { "data-testid": `stat-${cls}` }, value));
}

function totals(s: MonthSummary, digits: number): HTMLElement {
  const most = Math.max(s.income, s.spending, 1);
  const bar = (value: number, cls: string, label: string) =>
    h("div", { class: "bar-row" }, h("span", { class: "bar-label" }, label),
      h("div", { class: "bar-track" }, h("div", { class: `bar ${cls}`, style: `width: ${Math.round((value / most) * 100)}%` })));
  return h("section", { class: "panel totals", "aria-label": "Income against spending", "data-geo": "totals" },
    h("div", { class: "stats" },
      stat("Income", `+${formatAmount(s.income, digits)}`, "income"),
      stat("Spending", formatAmount(-s.spending, digits), "spending"),
      stat("Net", signed(s.net, digits), "net")),
    h("div", { class: "bars", "aria-hidden": "true" }, bar(s.income, "income", "Income"), bar(s.spending, "spending", "Spending")));
}

function categoryTable(ctx: Ctx, s: MonthSummary, digits: number): HTMLElement {
  if (s.lines.length === 0) return h("p", { class: "empty", "data-geo": "lines-empty" }, `No transactions in ${monthLabel(s.month)}.`);
  return h("table", { class: "ledger lines", "aria-label": "Categories this month", "data-geo": "lines" },
    h("thead", {}, h("tr", {},
      h("th", { scope: "col" }, "Category"),
      h("th", { scope: "col", class: "amount" }, "Total"),
      h("th", { scope: "col", class: "budget" }, "Monthly budget"),
      h("th", { scope: "col", class: "left" }, "Left"))),
    h("tbody", {}, ...s.lines.map((l) => h("tr", { "data-id": l.id ?? "none" },
      h("td", { class: l.id ? "name" : "name none" }, l.name),
      h("td", { class: "amount" }, signed(l.total, digits)),
      ...budgetCell(ctx, l, digits)))));
}

function monthTransactions(ctx: Ctx, s: MonthSummary, digits: number): HTMLElement | null {
  if (s.transactions.length === 0) return null;
  const name = (id: string | null) => ctx.snapshot.categories.find((c) => c.id === id)?.name;
  return h("table", { class: "ledger month-list", "aria-label": "Transactions this month" },
    h("thead", {}, h("tr", {},
      h("th", { scope: "col", class: "date" }, "Date"),
      h("th", { scope: "col" }, "Payee"),
      h("th", { scope: "col" }, "Category"),
      h("th", { scope: "col", class: "amount" }, `Amount (${ctx.snapshot.settings.currency})`))),
    h("tbody", {}, ...s.transactions.map((t) => h("tr", {},
      h("td", { class: "date" }, t.date),
      h("td", { class: "payee", title: t.payee }, t.payee),
      h("td", { class: name(t.categoryId) ? "category" : "category none" }, name(t.categoryId) ?? "Uncategorised"),
      h("td", { class: t.amount > 0 ? "amount income" : "amount spending" }, signed(t.amount, digits))))),
    h("tfoot", {}, h("tr", {},
      h("th", { scope: "row", colspan: 3 }, `Net for ${monthLabel(s.month)}`),
      h("td", { class: "amount", "data-testid": "month-total" }, signed(s.net, digits)))));
}

export function summaryView(ctx: Ctx): HTMLElement {
  const digits = currencyDigits(ctx.snapshot.settings.currency);
  const s = monthSummary(ctx.ui.month, ctx.snapshot.transactions, ctx.snapshot.categories);
  return h("section", { class: "view", "aria-labelledby": "view-title" },
    h("header", { class: "view-head" }, h("h1", { id: "view-title" }, "Summary")),
    monthNav(ctx),
    totals(s, digits),
    categoryTable(ctx, s, digits),
    monthTransactions(ctx, s, digits));
}
