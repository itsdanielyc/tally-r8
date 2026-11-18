// The column mapping for an import: which delimiter, which record is the
// header, which columns hold the date, payee and amount, the date order and
// the decimal separator. Every change redraws the preview.
import type { DateOrder, Delimiter, ImportMapping } from "../../contracts/tally";
import { type CsvInspection, inspectCsv } from "../../core/csv-inspect";
import { h } from "../dom";

export type PickedImport = { name: string; text: string; inspection: CsvInspection; mapping: ImportMapping };

type Option = [value: string, text: string];

const DELIMITER_NAMES: Record<Delimiter, string> = { ",": "Comma", ";": "Semicolon", "\t": "Tab", "|": "Pipe" };
const ORDER_NAMES: Record<DateOrder, string> = { YMD: "Year-month-day", DMY: "Day-month-year", MDY: "Month-day-year" };

function select(id: string, label: string, options: Option[], current: string, onChange: (value: string) => void): HTMLElement {
  const el = h("select", { id, name: id, onchange: () => onChange(el.value) },
    ...options.map(([value, text]) => h("option", { value, selected: value === current }, text)));
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), el);
}

function short(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Column names from the chosen header record, or "Column n". */
function columnNames(p: PickedImport): string[] {
  const width = p.inspection.columns.length;
  const header = p.mapping.headerRow === null ? [] : (p.inspection.records[p.mapping.headerRow]?.cells ?? []);
  return Array.from({ length: width }, (_, i) => header[i]?.trim() || `Column ${i + 1}`);
}

function amountFields(p: PickedImport, columns: Option[], change: (patch: Partial<ImportMapping>) => void): HTMLElement[] {
  const a = p.mapping.amount;
  const kindRadio = (kind: "signed" | "split", text: string) =>
    h("label", {}, h("input", {
      type: "radio", name: "amount-kind", value: kind, checked: a.kind === kind,
      onchange: () => change({ amount: kind === "signed" ? { kind, column: a.kind === "split" ? a.debit : a.column } : { kind, debit: a.kind === "signed" ? a.column : a.debit, credit: a.kind === "split" ? a.credit : Math.min(a.column + 1, columns.length - 1) } }),
    }), h("span", {}, text));
  const kind = h("div", { class: "field" },
    h("span", { class: "field-label", id: "amount-kind-label" }, "Amount is"),
    h("div", { class: "segmented", role: "radiogroup", "aria-labelledby": "amount-kind-label" },
      kindRadio("signed", "One column with a sign"), kindRadio("split", "Debit and credit columns")));
  if (a.kind === "signed") {
    return [kind, select("map-amount", "Amount column", columns, String(a.column), (v) => change({ amount: { kind: "signed", column: Number(v) } }))];
  }
  return [kind,
    select("map-debit", "Debit column (money out)", columns, String(a.debit), (v) => change({ amount: { ...a, debit: Number(v) } })),
    select("map-credit", "Credit column (money in)", columns, String(a.credit), (v) => change({ amount: { ...a, credit: Number(v) } }))];
}

const optionalValue = (column: number | null | undefined) => (column === null || column === undefined ? "none" : String(column));

/** The mapping form; `update` stores the new pick and redraws. */
export function mappingForm(p: PickedImport, update: (next: PickedImport) => void): HTMLElement {
  const change = (patch: Partial<ImportMapping>) => update({ ...p, mapping: { ...p.mapping, ...patch } });
  const columns: Option[] = columnNames(p).map((name, i) => [String(i), name]);
  const headerOptions: Option[] = [["none", "No header row"],
    ...p.inspection.records.slice(0, 12).map((r, i): Option => [String(i), `Line ${r.line}: ${short(r.cells.join(", "))}`])];
  return h("form", { class: "panel mapping", "aria-label": "Columns", "data-geo": "mapping", onsubmit: (e: Event) => e.preventDefault() },
    h("div", { class: "mapping-grid" },
      select("map-delimiter", "Delimiter", Object.entries(DELIMITER_NAMES), p.mapping.delimiter, (v) => {
        const inspection = inspectCsv(p.text, v as Delimiter);
        update({ ...p, inspection, mapping: inspection.mapping });
      }),
      select("map-header", "Header row", headerOptions, p.mapping.headerRow === null ? "none" : String(p.mapping.headerRow),
        (v) => change({ headerRow: v === "none" ? null : Number(v) })),
      select("map-date", "Date column", columns, String(p.mapping.date), (v) => change({ date: Number(v) })),
      select("map-order", "Date order", Object.entries(ORDER_NAMES), p.mapping.dateOrder, (v) => change({ dateOrder: v as DateOrder })),
      select("map-payee", "Payee column", columns, String(p.mapping.payee), (v) => change({ payee: Number(v) })),
      select("map-decimal", "Decimal separator", [[".", "Point (1,234.56)"], [",", "Comma (1.234,56)"]], p.mapping.decimal,
        (v) => change({ decimal: v === "," ? "," : "." })),
      select("map-category", "Category column (optional)", [["none", "None"], ...columns], optionalValue(p.mapping.category),
        (v) => change({ category: v === "none" ? null : Number(v) })),
      select("map-note", "Note column (optional)", [["none", "None"], ...columns], optionalValue(p.mapping.note),
        (v) => change({ note: v === "none" ? null : Number(v) })),
    ),
    h("div", { class: "mapping-amount" }, ...amountFields(p, columns, change)),
  );
}
