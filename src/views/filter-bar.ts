// The filter bar above the transaction list: text in the payee or note, a
// category, a date range and an amount range. Typing redraws only the list,
// so the field keeps its focus.
import { type Filter, isFiltered, NO_FILTER } from "../../core/filter";
import type { Ctx } from "../app";
import { h } from "../dom";

function text(ctx: Ctx, key: keyof Filter, label: string, attrs: Record<string, string>, onChange: () => void): HTMLElement {
  const input = h("input", {
    id: `filter-${key}`, name: key, autocomplete: "off", value: ctx.ui.filter[key], ...attrs,
    oninput: () => {
      ctx.ui.filter = { ...ctx.ui.filter, [key]: input.value };
      onChange();
    },
  });
  return h("label", { class: `field filter-${key}` }, h("span", { class: "field-label" }, label), input);
}

export function filterBar(ctx: Ctx, redrawList: () => void): HTMLElement {
  const clear = h("button", {
    type: "button", class: "quiet", disabled: !isFiltered(ctx.ui.filter),
    onclick: () => {
      ctx.ui.filter = { ...NO_FILTER };
      ctx.render();
    },
  }, "Clear");
  const onChange = () => {
    clear.disabled = !isFiltered(ctx.ui.filter);
    redrawList();
  };
  const category = h("select", {
    id: "filter-category", name: "category",
    onchange: () => {
      ctx.ui.filter = { ...ctx.ui.filter, category: category.value };
      onChange();
    },
  },
  h("option", { value: "", selected: ctx.ui.filter.category === "" }, "Any category"),
  h("option", { value: "none", selected: ctx.ui.filter.category === "none" }, "Uncategorised"),
  ...ctx.snapshot.categories.map((c) => h("option", { value: c.id, selected: ctx.ui.filter.category === c.id }, c.name)));
  return h("form", { class: "panel filters", role: "search", "aria-label": "Find transactions", "data-geo": "filters", onsubmit: (e: Event) => e.preventDefault() },
    h("div", { class: "filter-row" },
      text(ctx, "text", "Search", { type: "search", placeholder: "Payee or note text" }, onChange),
      h("div", { class: "field filter-category" }, h("label", { class: "field-label", for: "filter-category" }, "In"), category),
      text(ctx, "from", "From", { type: "date" }, onChange),
      text(ctx, "to", "To", { type: "date" }, onChange),
      text(ctx, "min", "At least", { inputmode: "decimal", placeholder: "0.00" }, onChange),
      text(ctx, "max", "At most", { inputmode: "decimal", placeholder: "0.00" }, onChange),
      clear),
  );
}
