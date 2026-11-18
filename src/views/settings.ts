// The Settings screen: the one currency the ledger is kept in.
import { CURRENCIES, findCurrency } from "../../core/money";
import type { Ctx } from "../app";
import { h } from "../dom";

export function settingsView(ctx: Ctx): HTMLElement {
  const current = ctx.snapshot.settings.currency;
  const select = h("select", { id: "currency", name: "currency" },
    ...CURRENCIES.map((c) => h("option", { value: c.code, selected: c.code === current }, `${c.code} — ${c.name}`)));
  const message = h("p", { class: "form-message", id: "currency-message", role: "status" });
  const save = async () => {
    const result = await ctx.backend.setCurrency(select.value);
    const error = ctx.apply(result);
    if (error) {
      message.textContent = error.message;
      message.classList.add("error");
    }
  };
  const digits = findCurrency(current)?.digits ?? 2;
  return h("section", { class: "view", "aria-labelledby": "view-title" },
    h("header", { class: "view-head" }, h("h1", { id: "view-title" }, "Settings")),
    h("form", {
      class: "panel settings", "aria-label": "Currency settings", "data-geo": "settings",
      onsubmit: (e: Event) => {
        e.preventDefault();
        void save();
      },
    },
    h("fieldset", { class: "settings-fields", disabled: ctx.snapshot.status.kind !== "ok" },
      h("label", { class: "field" }, h("span", { class: "field-label" }, "Currency"), select),
      h("button", { type: "submit", class: "primary" }, "Save currency"),
    ),
    h("p", { class: "hint" },
      `Amounts are kept in whole minor units (${digits} decimal places for ${current}). `,
      "The currency can change to one with a different number of decimal places only while the ledger is empty."),
    message),
  );
}
