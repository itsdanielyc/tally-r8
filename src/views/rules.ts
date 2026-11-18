// Payee rules: "payee contains this text, use this category". Rules apply to
// imported rows on their own, and to every uncategorised transaction when the
// person asks.
import type { Result, Snapshot } from "../../contracts/tally";
import type { Ctx } from "../app";
import { h } from "../dom";

type Send = (ctx: Ctx, call: Promise<Result<Snapshot>>, errorEl: HTMLElement, done?: string | null) => Promise<boolean>;

function ruleForm(ctx: Ctx, send: Send): HTMLElement {
  const contains = h("input", { id: "rule-contains", name: "contains", autocomplete: "off", maxlength: 100 });
  const category = h("select", { id: "rule-category", name: "category" },
    ...ctx.snapshot.categories.map((c) => h("option", { value: c.id }, c.name)));
  const error = h("p", { class: "form-error", role: "alert" });
  return h("form", {
    class: "panel inline-form", "aria-label": "Add a rule", "data-geo": "rule-new",
    onsubmit: (e: Event) => {
      e.preventDefault();
      ctx.ui.focus = "rule-contains";
      void send(ctx, ctx.backend.createRule(contains.value, category.value), error);
    },
  },
  h("div", { class: "inline-row" },
    h("label", { class: "field grow" }, h("span", { class: "field-label" }, "Payee contains"), contains),
    h("label", { class: "field grow" }, h("span", { class: "field-label" }, "Use category"), category),
    h("button", { type: "submit", class: "primary" }, "Add rule")),
  error);
}

function ruleTable(ctx: Ctx, send: Send): HTMLElement {
  const name = (id: string) => ctx.snapshot.categories.find((c) => c.id === id)?.name ?? "";
  const error = h("p", { class: "form-error", role: "alert" });
  return h("div", {},
    h("table", { class: "ledger rules", "aria-label": "Rules", "data-geo": "rules" },
      h("thead", {}, h("tr", {},
        h("th", { scope: "col" }, "Payee contains"),
        h("th", { scope: "col" }, "Category"),
        h("th", { scope: "col", class: "actions" }, h("span", { class: "visually-hidden" }, "Actions")))),
      h("tbody", {}, ...ctx.snapshot.rules.map((r) => h("tr", { "data-id": r.id },
        h("td", {}, `"${r.contains}"`),
        h("td", {}, name(r.categoryId)),
        h("td", { class: "actions" },
          h("button", { type: "button", class: "quiet", onclick: () => void send(ctx, ctx.backend.deleteRule(r.id), error) }, "Delete")))))),
    error);
}

async function applyNow(ctx: Ctx, error: HTMLElement): Promise<void> {
  const r = await ctx.backend.applyRules();
  if (!r.ok) {
    error.textContent = r.error.message;
    return;
  }
  ctx.ui.flash = `Categorised ${r.value.changed} ${r.value.changed === 1 ? "transaction" : "transactions"}.`;
  ctx.apply({ ok: true, value: r.value.snapshot });
}

export function rulesSection(ctx: Ctx, send: Send): HTMLElement {
  const error = h("p", { class: "form-error", role: "alert" });
  const hasRules = ctx.snapshot.rules.length > 0;
  return h("section", { class: "rules-section", "aria-labelledby": "rules-title" },
    h("h2", { id: "rules-title" }, "Rules"),
    h("p", { class: "hint" }, "A rule gives a category to transactions whose payee contains its text, ignoring case. Imported rows get it on import. When several rules match, the oldest wins."),
    ctx.snapshot.categories.length > 0 ? ruleForm(ctx, send) : h("p", { class: "hint" }, "Create a category first; a rule needs one."),
    hasRules ? ruleTable(ctx, send) : null,
    hasRules ? h("div", { class: "apply-rules" },
      h("button", { type: "button", onclick: () => void applyNow(ctx, error) }, "Apply rules to uncategorised transactions"),
      error) : null,
  );
}
