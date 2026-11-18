// A small element helper, so views read as a tree instead of a page of
// createElement calls. Attributes are set as attributes; "on<event>" keys
// become listeners; false, null and undefined are left out.

type Child = Node | string | null | undefined | false;
type Attr = string | number | boolean | null | undefined | ((event: Event) => void);

function setAttr(el: HTMLElement, key: string, value: Attr): void {
  if (value === false || value === null || value === undefined) return;
  if (typeof value === "function") el.addEventListener(key.slice(2), value);
  else if (key === "value" && "value" in el) (el as HTMLInputElement).value = String(value);
  else if (key === "checked" && el instanceof HTMLInputElement) el.checked = value === true;
  else el.setAttribute(key, value === true ? "" : String(value));
}

const present = (c: Child): c is Node | string => c !== null && c !== undefined && c !== false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, Attr> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) setAttr(el, key, value);
  el.append(...children.flat().filter(present));
  return el;
}

/** Replaces everything inside `parent` with `children`. */
export function replace(parent: Element, ...children: Child[]): void {
  parent.replaceChildren(...children.filter(present));
}
