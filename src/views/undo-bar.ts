// The undo bar: shown on every screen while the most recent delete, merge or
// import can still be undone. One click puts the ledger back as it was.
import type { Ctx } from "../app";
import { h } from "../dom";

export function undoBar(ctx: Ctx): HTMLElement | null {
  const undo = ctx.snapshot.undo;
  if (!undo) return null;
  const run = async () => {
    const r = await ctx.backend.undo();
    if (!r.ok) {
      ctx.ui.flash = r.error.message;
      ctx.render();
      return;
    }
    ctx.ui.flash = `Undone: ${undo.label}.`;
    ctx.ui.confirmDeleteId = null;
    ctx.apply(r);
  };
  return h("div", { class: "undo-bar", "data-testid": "undo-bar", "data-geo": "undo-bar" },
    h("span", {}, `${undo.label}.`),
    h("button", { type: "button", onclick: () => void run() }, "Undo"));
}
