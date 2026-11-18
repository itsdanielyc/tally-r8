// The entry form: adds a transaction, or edits the one picked in the list.
// The amount is typed unsigned and the Spending or Income choice signs it.
import type { Transaction, TransactionInput } from "../../contracts/tally";
import { localIsoDate } from "../../core/dates";
import { currencyDigits, parseTypedAmount, plainAmount } from "../../core/money";
import { NOTE_MAX, PAYEE_MAX } from "../../core/transactions";
import type { Ctx } from "../app";
import { h } from "../dom";

type Fields = {
  date: HTMLInputElement;
  income: HTMLInputElement;
  amount: HTMLInputElement;
  payee: HTMLInputElement;
  category: HTMLSelectElement;
  note: HTMLInputElement;
  error: HTMLElement;
};

function labelled(text: string, control: HTMLElement, cls: string): HTMLElement {
  return h("label", { class: `field ${cls}` }, h("span", { class: "field-label" }, text), control);
}

function kindChoice(fields: Pick<Fields, "income">, spending: HTMLInputElement): HTMLElement {
  return h("div", { class: "field kind" },
    h("span", { class: "field-label", id: "kind-label" }, "Kind"),
    h("div", { class: "segmented", role: "radiogroup", "aria-labelledby": "kind-label" },
      h("label", {}, spending, h("span", {}, "Spending")),
      h("label", {}, fields.income, h("span", {}, "Income")),
    ),
  );
}

function buildFields(ctx: Ctx, editing: Transaction | undefined): Fields & { spending: HTMLInputElement } {
  const digits = currencyDigits(ctx.snapshot.settings.currency);
  const isIncome = editing ? editing.amount > 0 : false;
  const options = [h("option", { value: "" }, "Uncategorised"),
    ...ctx.snapshot.categories.map((c) => h("option", { value: c.id, selected: editing?.categoryId === c.id }, c.name))];
  return {
    date: h("input", { id: "entry-date", type: "date", name: "date", required: true, value: editing?.date ?? localIsoDate(new Date()) }),
    spending: h("input", { type: "radio", name: "kind", value: "spending", checked: !isIncome }),
    income: h("input", { type: "radio", name: "kind", value: "income", checked: isIncome }),
    amount: h("input", { id: "entry-amount", name: "amount", inputmode: "decimal", autocomplete: "off", placeholder: "0.00",
      value: editing ? plainAmount(Math.abs(editing.amount), digits) : "" }),
    payee: h("input", { id: "entry-payee", name: "payee", maxlength: PAYEE_MAX, autocomplete: "off", value: editing?.payee ?? "" }),
    category: h("select", { id: "entry-category", name: "category" }, ...options),
    note: h("input", { id: "entry-note", name: "note", maxlength: NOTE_MAX, autocomplete: "off", value: editing?.note ?? "" }),
    error: h("p", { class: "form-error", id: "entry-error", role: "alert" }),
  };
}

function showError(f: Fields, field: string | undefined, message: string): void {
  for (const el of [f.date, f.amount, f.payee, f.category, f.note]) el.removeAttribute("aria-invalid");
  const target = { date: f.date, amount: f.amount, payee: f.payee, categoryId: f.category, note: f.note }[field ?? ""];
  target?.setAttribute("aria-invalid", "true");
  target?.focus();
  f.error.textContent = message;
}

async function submit(ctx: Ctx, f: Fields, editing: Transaction | undefined): Promise<void> {
  const typed = parseTypedAmount(f.amount.value, currencyDigits(ctx.snapshot.settings.currency));
  if (!typed.ok) return showError(f, "amount", typed.reason);
  const input: TransactionInput = {
    date: f.date.value,
    payee: f.payee.value,
    amount: f.income.checked ? typed.value : -typed.value,
    categoryId: f.category.value === "" ? null : f.category.value,
    note: f.note.value,
  };
  const result = editing ? await ctx.backend.updateTransaction(editing.id, input) : await ctx.backend.addTransaction(input);
  if (!result.ok) return showError(f, result.error.field, result.error.message);
  ctx.ui.editingId = null;
  ctx.ui.focus = "entry-amount";
  ctx.apply(result);
}

export function transactionForm(ctx: Ctx): HTMLFormElement {
  const editing = ctx.snapshot.transactions.find((t) => t.id === ctx.ui.editingId);
  const f = buildFields(ctx, editing);
  const cancel = () => {
    ctx.ui.editingId = null;
    ctx.render();
  };
  const actions = editing
    ? [h("button", { type: "submit", class: "primary" }, "Save"), h("button", { type: "button", onclick: cancel }, "Cancel")]
    : [h("button", { type: "submit", class: "primary" }, "Add")];
  // One save at a time: a second submit while the first is on its way is ignored.
  let busy = false;
  const form = h("form", {
    class: "entry",
    "aria-label": editing ? "Edit transaction" : "New transaction",
    "data-geo": "entry",
    onsubmit: (e: Event) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      void submit(ctx, f, editing).finally(() => {
        busy = false;
      });
    },
    onkeydown: (e: Event) => {
      if (editing && (e as KeyboardEvent).key === "Escape") cancel();
    },
  },
  h("fieldset", { class: "entry-fields", disabled: ctx.snapshot.status.kind !== "ok" },
    h("div", { class: "entry-row" },
      labelled("Date", f.date, "date"), kindChoice(f, f.spending), labelled("Amount", f.amount, "amount"), labelled("Payee", f.payee, "payee")),
    h("div", { class: "entry-row" },
      labelled("Category", f.category, "category"), labelled("Note", f.note, "note"), h("div", { class: "entry-actions" }, ...actions)),
  ),
  f.error);
  return form;
}
