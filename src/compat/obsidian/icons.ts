/**
 * setIcon / addIcon (API-REFERENCE area 5) — registry + a handful of built-in
 * stroke icons (drawn here, NOT copied from any icon library). Unknown icons
 * resolve to an empty placeholder span — never a crash.
 */
export type IconName = string;

/** addIcon()-registered icons (svgContent drawn on a 0 0 100 100 viewBox). */
const registered = new Map<string, string>();

function wrap(inner: string, viewBox: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="svg-icon" viewBox="${viewBox}" ` +
    `width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
  );
}

/** Minimal built-in set (24x24 strokes) for the most common plugin icons. */
const BUILTIN: Record<string, string> = {
  dice:
    '<rect x="3" y="3" width="18" height="18" rx="3"/>' +
    '<circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>',
  document: '<path d="M7 2.5h7l4 4V21.5H7z"/><path d="M14 2.5v4h4"/>',
  "file-text":
    '<path d="M7 2.5h7l4 4V21.5H7z"/><path d="M14 2.5v4h4"/>' +
    '<path d="M9.5 12h5"/><path d="M9.5 16h5"/>',
  gear:
    '<circle cx="12" cy="12" r="3.5"/>' +
    '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19"/>',
  settings:
    '<circle cx="12" cy="12" r="3.5"/>' +
    '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 6 6"/>',
  star: '<path d="m12 2.5 2.9 6.2 6.6.8-4.9 4.6 1.3 6.6-5.9-3.3-5.9 3.3 1.3-6.6L2.5 9.5l6.6-.8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="16" rx="2"/>' +
    '<path d="M8 2.5V7M16 2.5V7M3.5 10.5h17"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  pencil: '<path d="m4 20 .9-4.2L16.4 4.3a2 2 0 0 1 2.8 0l.5.5a2 2 0 0 1 0 2.8L8.2 19.1z"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M8 6.5V4h8v2.5"/><path d="M6.5 6.5 7.5 21h9l1-14.5"/>',
};

/** 'Adds an icon to the library.' svgContent = inner SVG markup (100x100 box). */
export function addIcon(iconId: string, svgContent: string): void {
  registered.set(iconId, svgContent);
}

/** @internal full <svg> markup for an icon id, or null when unknown. */
export function getIconSvg(iconId: string): string | null {
  const custom = registered.get(iconId);
  if (custom !== undefined) return wrap(custom, "0 0 100 100");
  const builtin = BUILTIN[iconId];
  return builtin !== undefined ? wrap(builtin, "0 0 24 24") : null;
}

/**
 * 'Returns an SVGSVGElement for the given icon id, or null if unknown.' (D16-2)
 * Parses the full <svg> markup via a <template> — the HTML parser handles
 * <svg> in foreign-content mode, yielding a real SVGSVGElement. An instanceof
 * guard returns it (no cast / any); anything else degrades to null.
 */
export function getIcon(iconId: string): SVGSVGElement | null {
  const markup = getIconSvg(iconId);
  if (markup === null) return null;
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  const el = template.content.firstElementChild;
  return el instanceof SVGSVGElement ? el : null;
}

/** 'Returns a list of all registered icon ids.' (D16-2) built-ins + addIcon()s. */
export function getIconIds(): string[] {
  return [...Object.keys(BUILTIN), ...registered.keys()];
}

/** Sets a tooltip via aria-label + title (Geode has no custom tooltip popup). */
export function setTooltip(el: HTMLElement, tooltip: string, _options?: unknown): void {
  el.setAttribute("aria-label", tooltip);
  el.title = tooltip;
}

/** Inserts the SVG for iconId into parent (clearing it first). */
export function setIcon(parent: HTMLElement, iconId: IconName): void {
  parent.textContent = "";
  const svg = getIconSvg(iconId);
  if (svg) {
    parent.insertAdjacentHTML("beforeend", svg);
  } else {
    const span = document.createElement("span");
    span.className = "geode-icon-missing";
    span.setAttribute("data-icon", iconId);
    parent.appendChild(span);
  }
}
