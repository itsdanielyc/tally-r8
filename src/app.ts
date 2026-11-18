// The window's shell: the section list, the current screen and the status
// bar. Screens render from the last Snapshot the backend returned; a change
// sends one call, and the Snapshot that comes back is drawn whole.
import type { Result, Snapshot, TallyError } from "../contracts/tally";
import type { Backend } from "./api";
import { localIsoDate } from "../core/dates";
import { type Filter, NO_FILTER } from "../core/filter";
import { h, replace } from "./dom";
import { categoriesView } from "./views/categories";
import { type ImportState, importView } from "./views/import";
import { settingsView } from "./views/settings";
import { summaryView } from "./views/summary";
import { undoBar } from "./views/undo-bar";
import { transactionsView } from "./views/transactions";

type ViewName = "transactions" | "import" | "categories" | "summary" | "settings";

/** Screen state that is not ledger data and does not survive a restart. */
type UiState = {
  view: ViewName;
  editingId: string | null;
  confirmDeleteId: string | null;
  renamingId: string | null;
  /** The month the Summary shows, "YYYY-MM"; and the category whose budget is being edited. */
  month: string;
  budgetEditId: string | null;
  importing: ImportState;
  /** What the Transactions list is filtered by; kept while moving between screens. */
  filter: Filter;
  /** A one-line result shown once, on the next drawing, such as how many rules applied. */
  flash: string | null;
  /** The control to focus after the next render, by element id. */
  focus: string | null;
};

export type Ctx = {
  readonly backend: Backend;
  readonly snapshot: Snapshot;
  readonly ui: UiState;
  /** Takes a call's result: draws the new Snapshot, or hands back the error. */
  apply(result: Result<Snapshot>): TallyError | null;
  /** Draws again after a change to `ui` alone. */
  render(): void;
};

const VIEWS: { name: ViewName; label: string; draw: (ctx: Ctx) => HTMLElement }[] = [
  { name: "transactions", label: "Transactions", draw: transactionsView },
  { name: "import", label: "Import", draw: importView },
  { name: "categories", label: "Categories", draw: categoriesView },
  { name: "summary", label: "Summary", draw: summaryView },
  { name: "settings", label: "Settings", draw: settingsView },
];

export async function startApp(root: HTMLElement, backend: Backend): Promise<void> {
  let snapshot = await backend.load();
  const ui: UiState = { view: "transactions", editingId: null, confirmDeleteId: null, renamingId: null, month: localIsoDate(new Date()).slice(0, 7), budgetEditId: null, importing: { file: null, result: null }, filter: { ...NO_FILTER }, flash: null, focus: null };
  const nav = h("nav", { class: "sidebar", "aria-label": "Sections", "data-geo": "sidebar" });
  const main = h("main", { class: "main", "data-geo": "main" });
  const status = h("footer", { class: "statusbar", "data-geo": "statusbar" });
  replace(root, h("div", { class: "shell" }, nav, main, status));

  const ctx = (): Ctx => ({
    backend,
    snapshot,
    ui,
    apply(result) {
      if (!result.ok) return result.error;
      snapshot = result.value;
      render();
      return null;
    },
    render,
  });

  function drawNav(): void {
    const items = VIEWS.map((v) =>
      h("li", {}, h("button", {
        type: "button",
        class: "nav-item",
        "aria-current": ui.view === v.name ? "page" : false,
        onclick: () => {
          Object.assign(ui, { view: v.name, editingId: null, confirmDeleteId: null, renamingId: null, budgetEditId: null, flash: null });
          render();
        },
      }, v.label)),
    );
    replace(nav, h("p", { class: "brand" }, "Tally"), h("ul", { class: "nav" }, ...items));
  }

  function drawStatus(): void {
    replace(status,
      h("span", { class: "ledger-file" }, "Ledger: ", h("span", { "data-testid": "ledger-file" }, snapshot.file)),
      h("span", { class: "backend" }, "backend: ", h("strong", { "data-testid": "backend-badge", "data-kind": backend.kind }, backend.kind)),
    );
  }

  function render(): void {
    drawNav();
    const view = VIEWS.find((v) => v.name === ui.view) ?? VIEWS[0];
    const banner = snapshot.status.kind === "ok" ? null : h("div", { class: "banner", role: "alert" }, snapshot.status.message);
    const flash = ui.flash ? h("p", { class: "flash", role: "status" }, ui.flash) : null;
    ui.flash = null;
    replace(main, banner, undoBar(ctx()), flash, view.draw(ctx()));
    drawStatus();
    if (ui.focus) document.getElementById(ui.focus)?.focus();
    ui.focus = null;
  }

  render();
}
