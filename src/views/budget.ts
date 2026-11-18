// The budget cells of a summary line: the monthly budget (set, change or
// remove it in place) and what is left or over, with a simple bar.
import { parseTypedAmount, plainAmount, formatAmount } from "../../core/money";
import type { MonthSummary } from "../../core/summary";
import type { Ctx } from "../app";
import { h } from "../dom";

type Line = MonthSummary["lines"][number];

function editor(ctx: Ctx, l: Line & { id: string }, digits: number): HTMLElement {
  const input = h("input", { id: "budget-input", "aria-label": `Monthly budget for ${l.name}`, inputmode: "decimal", autocomplete: "off",
    value: l.budget === null ? "" : plainAmount(l.budget, digits) });
  const error = h("span", { class: "form-error", role: "alert" });
  const done = (amount: number | null) => {
    void ctx.backend.setBudget(l.id, amount).then((r) => {
      if (!r.ok) {
        error.textContent = r.error.message;
        return;
      }
      ctx.ui.budgetEditId = null;
      ctx.apply(r);
    });
  };
  return h("form", {
    class: "budget-form",
    onsubmit: (e: Event) => {
      e.preventDefault();
      const typed = parseTypedAmount(input.value, digits);
      if (!typed.ok) error.textContent = typed.reason;
      else done(typed.value);
    },
    onkeydown: (e: Event) => {
      if ((e as KeyboardEvent).key !== "Escape") return;
      ctx.ui.budgetEditId = null;
      ctx.render();
    },
  },
  input,
  h("button", { type: "submit", class: "primary" }, "Save"),
  l.budget !== null && h("button", { type: "button", onclick: () => done(null) }, "Remove"),
  error);
}

function leftCell(l: Line, digits: number): HTMLElement {
  if (l.budget === null || l.left === null) return h("td", { class: "left none" }, "—");
  const used = l.budget > 0 ? Math.min(100, Math.max(0, Math.round((l.spent / l.budget) * 100))) : 0;
  const over = l.left < 0;
  return h("td", { class: over ? "left over" : "left" },
    h("span", { class: "left-text" }, over ? `${formatAmount(-l.left, digits)} over` : `${formatAmount(l.left, digits)} left`),
    h("span", { class: "meter", "aria-hidden": "true" }, h("span", { class: over ? "meter-fill over" : "meter-fill", style: `width: ${used}%` })));
}

export function budgetCell(ctx: Ctx, l: Line, digits: number): HTMLElement[] {
  if (l.id === null) return [h("td", { class: "budget none" }, "—"), h("td", { class: "left none" }, "—")];
  const id = l.id;
  if (ctx.ui.budgetEditId === id) return [h("td", { class: "budget editing", colspan: 2 }, editor(ctx, { ...l, id }, digits))];
  const readonly = ctx.snapshot.status.kind !== "ok";
  return [
    h("td", { class: "budget" },
      h("span", { class: "budget-text" }, l.budget === null ? "—" : formatAmount(l.budget, digits)),
      h("button", { type: "button", class: "quiet", disabled: readonly, "aria-label": `${l.budget === null ? "Set" : "Change"} budget for ${l.name}`,
        onclick: () => {
          ctx.ui.budgetEditId = id;
          ctx.ui.focus = "budget-input";
          ctx.render();
        } }, l.budget === null ? "Set" : "Change")),
    leftCell(l, digits),
  ];
}
