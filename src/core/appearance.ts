/**
 * R50 Appearance settings — readable line length + editor spellcheck (#⑲).
 * Mirrors the localStorage-backed Store + setter pattern (autoUpdateLinks /
 * templateFolder / dailyNoteFolder). App-level zoom reuses workspace.fontSize
 * (commands in App.tsx). Defaults preserve the prior behavior (readable line ON =
 * the existing 46em cap; spellcheck OFF).
 */
import { Store } from "./store";

const READABLE_KEY = "geode.readableLineLength";
const SPELLCHECK_KEY = "geode.spellcheck";
const ACCENT_KEY = "geode.accentColor";

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "true";
  } catch {
    return fallback;
  }
}

function persistBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable — session-only */
  }
}

/** Cap the editor/preview body width at ~46em, centered (default ON = the prior
 *  always-on behavior). OFF → full width via `--readable-line-width: none`; the
 *  editor + preview CSS read `var(--readable-line-width, 46em)`. */
export const readableLineLength = new Store<boolean>(readBool(READABLE_KEY, true));

function applyReadableLineLength(on: boolean): void {
  try {
    const el = document.documentElement;
    if (on) el.style.removeProperty("--readable-line-width"); // → CSS 46em fallback
    else el.style.setProperty("--readable-line-width", "none");
  } catch {
    /* no DOM (non-browser test context) */
  }
}

export function setReadableLineLength(on: boolean): void {
  readableLineLength.set(on);
  persistBool(READABLE_KEY, on);
  applyReadableLineLength(on);
}

/** Editor spellcheck (browser squiggles on the CM contentDOM). Default OFF (prior
 *  behavior). EditorPane applies it per-view reactively via useStore. */
export const spellcheckEnabled = new Store<boolean>(readBool(SPELLCHECK_KEY, false));

export function setSpellcheckEnabled(on: boolean): void {
  spellcheckEnabled.set(on);
  persistBool(SPELLCHECK_KEY, on);
}

/** R88 (㊶ 续): show line-number gutter in the editor (live + source). Default OFF
 *  (Obsidian default, and zero-regression — Geode had no line numbers). Applied per
 *  CM view via a Compartment reconfigured reactively in EditorPane. */
const LINE_NUMBERS_KEY = "geode.showLineNumbers";
export const showLineNumbers = new Store<boolean>(readBool(LINE_NUMBERS_KEY, false));

export function setShowLineNumbers(on: boolean): void {
  showLineNumbers.set(on);
  persistBool(LINE_NUMBERS_KEY, on);
}

/** R88 (㊶ 续): the mode a NEW markdown tab opens in (Obsidian's "Default view for
 *  new tabs" + "Default editing mode" combined). Default "live" = current behaviour
 *  (zero regression). Consumed by workspace.openFile. */
export type NewTabMode = "live" | "source" | "preview";
const DEFAULT_TAB_MODE_KEY = "geode.defaultNewTabMode";

function readTabMode(): NewTabMode {
  try {
    const v = localStorage.getItem(DEFAULT_TAB_MODE_KEY);
    return v === "source" || v === "preview" ? v : "live";
  } catch {
    return "live";
  }
}

export const defaultNewTabMode = new Store<NewTabMode>(readTabMode());

export function setDefaultNewTabMode(mode: NewTabMode): void {
  defaultNewTabMode.set(mode);
  persistString(DEFAULT_TAB_MODE_KEY, mode);
}

/** R87 (㊶): strict line breaks in the READING view. OFF (default) = a single
 *  newline renders as `<br>` (Obsidian's default reading behaviour); ON = strict
 *  CommonMark (single newline joins; needs two trailing spaces / a blank line).
 *  Consumed at render time (markdown-it `breaks` = `!strictLineBreaks`); no DOM
 *  side-effect, so no apply-on-boot. Live preview is unaffected (CM shows the
 *  newline you typed regardless, matching Obsidian). */
const STRICT_LINEBREAKS_KEY = "geode.strictLineBreaks";
export const strictLineBreaks = new Store<boolean>(readBool(STRICT_LINEBREAKS_KEY, false));

export function setStrictLineBreaks(on: boolean): void {
  strictLineBreaks.set(on);
  persistBool(STRICT_LINEBREAKS_KEY, on);
}

/* ---------------- R79: accent color ---------------- */

function readString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function persistString(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable — session-only */
  }
}

/** User accent override (`#rrggbb`), or "" = no override (use the theme default).
 *  Overrides `--accent` + derived `--accent-hover`/`--accent-muted`. */
export const accentColor = new Store<string>(readString(ACCENT_KEY, ""));

function applyAccentColor(color: string): void {
  try {
    const el = document.documentElement;
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      // empty / invalid → drop the overrides, falling back to the :root defaults
      el.style.removeProperty("--accent");
      el.style.removeProperty("--accent-hover");
      el.style.removeProperty("--accent-muted");
      return;
    }
    el.style.setProperty("--accent", color);
    el.style.setProperty("--accent-hover", `color-mix(in srgb, ${color}, white 14%)`);
    el.style.setProperty("--accent-muted", `color-mix(in srgb, ${color} 18%, transparent)`);
  } catch {
    /* no DOM (non-browser test context) */
  }
}

export function setAccentColor(color: string): void {
  accentColor.set(color);
  persistString(ACCENT_KEY, color);
  applyAccentColor(color);
}

/* ---------------- R85 (㊺): font families ---------------- */

const INTERFACE_FONT_KEY = "geode.interfaceFont";
const TEXT_FONT_KEY = "geode.textFont";
const MONOSPACE_FONT_KEY = "geode.monospaceFont";

// default stacks — kept byte-identical to the CSS `var(--font-*, <stack>)`
// fallbacks so an unset font and a removed override render the same.
const STACK_INTERFACE = '"Segoe UI", -apple-system, system-ui, sans-serif';
const STACK_MONOSPACE = 'ui-monospace, "Cascadia Code", Consolas, "SF Mono", Menlo, monospace';

/**
 * Clean a user-typed font family NAME into a single safe token (no CSS injection):
 * a custom-property value substituted via `var()` cannot break out of a rule per
 * spec, but we still strip quotes/`;{}()<>`/backslashes/newlines so the value is a
 * plain family name we then quote ourselves. "" = no override. Exported for the probe.
 */
export function sanitizeFontFamily(raw: string): string {
  // strip the breakout chars (quotes/backslash/`;{}()<>`) + control chars (which
  // would otherwise make the quoted value an invalid declaration and silently drop
  // the override) — but NOT \t\n\r, so `\s+` can normalise those to single spaces.
  return raw
    .replace(/["'\\;{}()<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Build the CSS value for a font override: the quoted user family + the default
 *  stack as fallback, or "" when there is no (valid) override. */
function fontValue(raw: string, stack: string): string {
  const name = sanitizeFontFamily(raw);
  return name ? `"${name}", ${stack}` : "";
}

function applyFont(prop: string, raw: string, stack: string): void {
  try {
    const el = document.documentElement;
    const value = fontValue(raw, stack);
    if (value) el.style.setProperty(prop, value);
    else el.style.removeProperty(prop); // → CSS var() fallback stack
  } catch {
    /* no DOM (non-browser test context) */
  }
}

/** Interface font: app chrome (menus, sidebars, tree). "" = theme default. */
export const interfaceFont = new Store<string>(readString(INTERFACE_FONT_KEY, ""));
/** Text font: note prose (editor + reading view). Inherits interface when unset. */
export const textFont = new Store<string>(readString(TEXT_FONT_KEY, ""));
/** Monospace font: code spans / blocks. "" = default mono stack. */
export const monospaceFont = new Store<string>(readString(MONOSPACE_FONT_KEY, ""));

export function setInterfaceFont(raw: string): void {
  interfaceFont.set(raw);
  persistString(INTERFACE_FONT_KEY, sanitizeFontFamily(raw));
  applyFont("--font-interface", raw, STACK_INTERFACE);
}
export function setTextFont(raw: string): void {
  textFont.set(raw);
  persistString(TEXT_FONT_KEY, sanitizeFontFamily(raw));
  // when the text font is set-but-missing, fall back to the user's interface
  // override (then its default stack) — mirrors the CSS var(--font-text, var(--font-interface, …)).
  applyFont("--font-text", raw, `var(--font-interface, ${STACK_INTERFACE})`);
}
export function setMonospaceFont(raw: string): void {
  monospaceFont.set(raw);
  persistString(MONOSPACE_FONT_KEY, sanitizeFontFamily(raw));
  applyFont("--font-monospace", raw, STACK_MONOSPACE);
}

/** Apply DOM-affecting appearance settings on boot (call once the document exists). */
export function applyAppearanceSettings(): void {
  applyReadableLineLength(readableLineLength.get());
  applyAccentColor(accentColor.get());
  applyFont("--font-interface", interfaceFont.get(), STACK_INTERFACE);
  applyFont("--font-text", textFont.get(), STACK_INTERFACE);
  applyFont("--font-monospace", monospaceFont.get(), STACK_MONOSPACE);
}
