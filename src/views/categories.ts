// The Categories screen: create, rename, delete and merge categories. The
// payee rules sit below it (src/views/rules.ts).
import type { Category, Result, Snapshot } from "../../contracts/tally";
import type { Ctx } from "../app";
import { h } from "../dom";
import { rulesSection } from "./rules";

/** Sends a change; on success shows `done`, on failure the error in `errorEl`. */
async function send(ctx: Ctx, call: Promise<Result<Snapshot>>, errorEl: HTMLElement, done: string | null = null): Promise<void> {
  const r = await call;
  if (!r.ok) {
    errorEl.textContent = r.error.message;
    return;
  }
  ctx.ui.flash = done;
  ctx.apply(r);
}

function createForm(ctx: Ctx): HTMLElement {
  const name = h("input", { id: "category-name", name: "name", autocomplete: "off", maxlength: 60 });
  const error = h("p", { class: "form-error", role: "alert" });
  return h("form", {
    class: "panel inline-form", "aria-label": "Create a category", "data-geo": "category-new",
    onsubmit: (e: Event) => {
      e.preventDefault();
      ctx.ui.focus = "category-name";
      void send(ctx, ctx.backend.createCategory(name.value), error);
    },
  },
  h("div", { class: "inline-row" },
    h("label", { class: "field grow" }, h("span", { class: "field-label" }, "New category"), name),
    h("button", { type: "submit", class: "primary" }, "Create")),
  error);
}

function renameCell(ctx: Ctx, c: Category): HTMLElement {
  const input = h("input", { id: "rename-input", "aria-label": `New name for ${c.name}`, value: c.name, maxlength: 60 });
  const error = h("span", { class: "form-error", role: "alert" });
  const cancel = () => {
    ctx.ui.renamingId = null;
    ctx.render();
  };
  return h("td", { class: "name", colspan: 2 },
    h("form", {
      class: "rename",
      onsubmit: (e: Event) => {
        e.preventDefault();
        ctx.ui.renamingId = null;
        void send(ctx, ctx.backend.renameCategory(c.id, input.value), error).then(() => {
          if (error.textContent) ctx.ui.renamingId = c.id;
        });
      },
      onkeydown: (e: Event) => {
        if ((e as KeyboardEvent).key === "Escape") cancel();
      },
    }, input, h("button", { type: "submit", class: "primary" }, "Save"), h("button", { type: "button", onclick: cancel }, "Cancel"), error),
  );
}

function actions(ctx: Ctx, c: Category, used: number): HTMLElement {
  const set = (patch: Partial<Ctx["ui"]>) => {
    Object.assign(ctx.ui, patch);
    ctx.render();
  };
  if (ctx.ui.confirmDeleteId === c.id) {
    const error = h("span", { class: "form-error", role: "alert" });
    return h("td", { class: "actions confirm" },
      h("span", { class: "visually-hidden" }, `Delete ${c.name}? Its ${used} transactions become uncategorised.`),
      h("button", { type: "button", class: "danger", onclick: () => {
        ctx.ui.confirmDeleteId = null;
        void send(ctx, ctx.backend.deleteCategory(c.id), error, `Deleted ${c.name}; ${used} ${used === 1 ? "transaction is" : "transactions are"} now uncategorised.`);
      } }, "Yes, delete"),
      h("button", { type: "button", onclick: () => set({ confirmDeleteId: null }) }, "Keep"),
      error);
  }
  return h("td", { class: "actions" },
    h("button", { type: "button", class: "quiet", onclick: () => set({ renamingId: c.id, confirmDeleteId: null, focus: "rename-input" }) }, "Rename"),
    h("button", { type: "button", class: "quiet", onclick: () => set({ confirmDeleteId: c.id, renamingId: null }) }, "Delete"));
}

function categoryTable(ctx: Ctx): HTMLElement {
  const counts = new Map<string, number>();
  for (const t of ctx.snapshot.transactions) if (t.categoryId) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  return h("table", { class: "ledger categories", "aria-label": "Categories", "data-geo": "categories" },
    h("thead", {}, h("tr", {},
      h("th", { scope: "col" }, "Name"),
      h("th", { scope: "col", class: "amount" }, "Transactions"),
      h("th", { scope: "col", class: "actions" }, h("span", { class: "visually-hidden" }, "Actions")))),
    h("tbody", {}, ...ctx.snapshot.categories.map((c) => {
      const used = counts.get(c.id) ?? 0;
      const state = ctx.ui.confirmDeleteId === c.id ? "confirming" : false;
      return ctx.ui.renamingId === c.id
        ? h("tr", { "data-id": c.id }, renameCell(ctx, c), actions(ctx, c, used))
        : h("tr", { "data-id": c.id, class: state }, h("td", { class: "name" }, c.name), h("td", { class: "amount" }, String(used)), actions(ctx, c, used));
    })),
  );
}

function mergeForm(ctx: Ctx): HTMLElement | null {
  const cats = ctx.snapshot.categories;
  if (cats.length < 2) return null;
  const options = (selected: number) => cats.map((c, i) => h("option", { value: c.id, selected: i === selected }, c.name));
  const from = h("select", { id: "merge-from" }, ...options(0));
  const into = h("select", { id: "merge-into" }, ...options(1));
  const error = h("p", { class: "form-error", role: "alert" });
  return h("form", {
    class: "panel inline-form", "aria-label": "Merge categories", "data-geo": "category-merge",
    onsubmit: (e: Event) => {
      e.preventDefault();
      const names = (id: string) => cats.find((c) => c.id === id)?.name ?? "";
      void send(ctx, ctx.backend.mergeCategories(from.value, into.value), error, `Merged ${names(from.value)} into ${names(into.value)}.`);
    },
  },
  h("div", { class: "inline-row" },
    h("label", { class: "field grow" }, h("span", { class: "field-label" }, "Merge"), from),
    h("label", { class: "field grow" }, h("span", { class: "field-label" }, "into"), into),
    h("button", { type: "submit" }, "Merge")),
  h("p", { class: "hint" }, "Every transaction and rule of the first category moves to the second, and the first is removed."),
  error);
}

export function categoriesView(ctx: Ctx): HTMLElement {
  const n = ctx.snapshot.categories.length;
  return h("section", { class: "view", "aria-labelledby": "view-title" },
    h("header", { class: "view-head" },
      h("h1", { id: "view-title" }, "Categories"),
      h("p", { class: "count" }, `${n} ${n === 1 ? "category" : "categories"}`)),
    h("fieldset", { class: "plain", disabled: ctx.snapshot.status.kind !== "ok" },
      createForm(ctx),
      n > 0 ? categoryTable(ctx) : h("p", { class: "empty", "data-geo": "empty" }, "No categories yet. Create the first one above."),
      mergeForm(ctx),
      rulesSection(ctx, send)),
  );
}
