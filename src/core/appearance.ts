/**
 * R50 Appearance settings — readable line length + editor spellcheck (#⑲).
 * Mirrors the localStorage-backed Store + setter pattern (autoUpdateLinks /
 * templateFolder / dailyNoteFolder). App-level zoom reuses workspace.fontSize
 * (commands in App.tsx). Defaults preserve the prior behavior (readable line ON =
 * the existing 46em cap; spellcheck OFF).
 */
import { Store } from "./store";
import type { ExplorerSortKey } from "./vault";

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

/** R226 (G8): Obsidian's "Right-to-left" — set the editor + reading view default text
 *  direction to RTL. Default OFF (LTR, prior behavior). Pure visual: EditorPane sets the CM
 *  contentDOM `dir` (CM6's native bidi handles cursor/selection) + the preview div `dir`. */
const RTL_KEY = "geode.rightToLeft";
export const rightToLeft = new Store<boolean>(readBool(RTL_KEY, false));

export function setRightToLeft(on: boolean): void {
  rightToLeft.set(on);
  persistBool(RTL_KEY, on);
}

/** R227 (G8): Obsidian's "Quick font size adjustment" — hold Ctrl/Cmd and scroll to change the
 *  font size. Default OFF (Obsidian default + zero-regression — Geode had no wheel zoom). App.tsx
 *  installs a global wheel listener gated on this; the change reuses the vetted workspace.setFontSize. */
const QUICK_FONT_ZOOM_KEY = "geode.quickFontZoom";
export const quickFontZoom = new Store<boolean>(readBool(QUICK_FONT_ZOOM_KEY, false));

export function setQuickFontZoom(on: boolean): void {
  quickFontZoom.set(on);
  persistBool(QUICK_FONT_ZOOM_KEY, on);
}

/** R91 (㊽): explorer file-tree sort order. Default "name-asc" = the canonical
 *  stored order (zero regression). Presentation-only (consumed at render time). */
const EXPLORER_SORT_KEY = "geode.explorerSort";

function readExplorerSort(): ExplorerSortKey {
  try {
    return localStorage.getItem(EXPLORER_SORT_KEY) === "name-desc" ? "name-desc" : "name-asc";
  } catch {
    return "name-asc";
  }
}

export const explorerSort = new Store<ExplorerSortKey>(readExplorerSort());

export function setExplorerSort(key: ExplorerSortKey): void {
  explorerSort.set(key);
  persistString(EXPLORER_SORT_KEY, key === "name-asc" ? "" : key);
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

/** R224 (G8): Obsidian's "Hide reference marks" — in Live Preview, hide Markdown syntax
 *  delimiters except at the cursor. Default ON (Obsidian default + zero-regression — Geode's
 *  live preview always hid them). OFF shows all marks while keeping widgets/styles rendered
 *  (not source mode). Applied per CM view via the mode Compartment, reconfigured in EditorPane. */
const HIDE_REF_MARKS_KEY = "geode.hideReferenceMarks";
export const hideReferenceMarks = new Store<boolean>(readBool(HIDE_REF_MARKS_KEY, true));

export function setHideReferenceMarks(on: boolean): void {
  hideReferenceMarks.set(on);
  persistBool(HIDE_REF_MARKS_KEY, on);
}

/** R153 (㊶): Obsidian's "Auto pair brackets" — auto-close `( [ { " '` while typing.
 *  Default ON (Obsidian default + zero-regression — Geode had closeBrackets() always on).
 *  Applied per CM view via a Compartment reconfigured reactively in EditorPane. */
const AUTO_PAIR_KEY = "geode.autoPairBrackets";
export const autoPairBrackets = new Store<boolean>(readBool(AUTO_PAIR_KEY, true));

export function setAutoPairBrackets(on: boolean): void {
  autoPairBrackets.set(on);
  persistBool(AUTO_PAIR_KEY, on);
}

/** R225 (G8): Obsidian's "Auto pair Markdown syntax" — auto-wrap a selection with emphasis
 *  marks (`* _ ~ = $ \``) on a single keypress. Default ON (Obsidian default + zero-regression —
 *  Geode's markdownWrapHandler was always on since R35). Applied per CM view via a Compartment
 *  reconfigured reactively in EditorPane (mirrors autoPairBrackets). */
const AUTO_PAIR_MD_KEY = "geode.autoPairMarkdown";
export const autoPairMarkdown = new Store<boolean>(readBool(AUTO_PAIR_MD_KEY, true));

export function setAutoPairMarkdown(on: boolean): void {
  autoPairMarkdown.set(on);
  persistBool(AUTO_PAIR_MD_KEY, on);
}

/** R154 (㊷): Obsidian's "Backlink in document" — show the note's linked mentions at
 *  the bottom of the reading view. Default OFF (Obsidian opt-in). Read-only: the section
 *  is appended below the rendered content in EditorPane, so it never touches the markdown
 *  render pipeline (§C byte invariant untouched). */
const BACKLINKS_IN_DOC_KEY = "geode.backlinksInDocument";
export const showBacklinksInDocument = new Store<boolean>(readBool(BACKLINKS_IN_DOC_KEY, false));

export function setShowBacklinksInDocument(on: boolean): void {
  showBacklinksInDocument.set(on);
  persistBool(BACKLINKS_IN_DOC_KEY, on);
}

/** R155 (㊽): Obsidian's "Detect all file extensions" — show every file's extension in the
 *  explorer, including the `.md` on markdown notes. Default OFF (Obsidian default + zero
 *  regression — Geode already shows non-md extensions as a badge; this just relaxes the gate
 *  so `.md` notes show their badge too). Consumed by Explorer's `.explorer-ext` render. */
const DETECT_ALL_EXT_KEY = "geode.detectAllExtensions";
export const detectAllExtensions = new Store<boolean>(readBool(DETECT_ALL_EXT_KEY, false));

export function setDetectAllExtensions(on: boolean): void {
  detectAllExtensions.set(on);
  persistBool(DETECT_ALL_EXT_KEY, on);
}

/** R156 (㊶): Obsidian's "Fold heading" Editor setting — whether the editor offers fold points
 *  for heading sections. Default ON (Obsidian default + zero regression — Geode's foldService
 *  offered heading folds unconditionally). Gates the heading branch of markdownFoldRange; the
 *  foldService lives in a Compartment that EditorPane reconfigures (mirrors R153's closeBrackets).
 *  NOTE: Obsidian's sibling "Fold indent" is deferred — CM's foldable() falls back to the built-in
 *  syntaxFolding (foldNodeProp) for multi-line blocks, which folds a list item's inner paragraph
 *  even when our list foldService is gated off; suppressing it needs parser surgery on the frozen
 *  R17 fold language (out of scope). Heading folds are NOT subject to that fallback (foldNodeProp
 *  excludes headings), so "Fold heading" is fully gateable here. */
const FOLD_HEADING_KEY = "geode.foldHeading";
export const foldHeading = new Store<boolean>(readBool(FOLD_HEADING_KEY, true));

export function setFoldHeading(on: boolean): void {
  foldHeading.set(on);
  persistBool(FOLD_HEADING_KEY, on);
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

/** R92 (㊶ 续续): editor indentation. Mirrors Obsidian's "Indent using tabs"
 *  (default ON → insert a tab char; OFF → spaces) + "Tab indent size" (default 4 =
 *  one indent level's width). Both default to Obsidian's shipped values; this is a
 *  deliberate alignment (Geode previously inserted CM's default 2 spaces on Tab —
 *  no existing .md is rewritten, only future Tab presses differ). The CM translation
 *  lives in cmExtensions.indentExtensions — a Compartment reconfigured per-view in
 *  EditorPane, mirroring R88's lineNumberCompartment. */
const TAB_SIZE_KEY = "geode.tabIndentSize";
const INDENT_TABS_KEY = "geode.indentUsingTabs";

/** Clamp a tab indent size to a sane integer width (1–8, Obsidian-style); junk → 4. */
export function clampTabSize(n: number): number {
  return Number.isFinite(n) ? Math.min(8, Math.max(1, Math.round(n))) : 4;
}

function readTabSize(): number {
  try {
    const v = localStorage.getItem(TAB_SIZE_KEY);
    return v === null ? 4 : clampTabSize(Number(v));
  } catch {
    return 4;
  }
}

export const tabIndentSize = new Store<number>(readTabSize());
export const indentUsingTabs = new Store<boolean>(readBool(INDENT_TABS_KEY, true));

export function setTabIndentSize(n: number): void {
  const size = clampTabSize(n);
  tabIndentSize.set(size);
  persistString(TAB_SIZE_KEY, String(size));
}

export function setIndentUsingTabs(on: boolean): void {
  indentUsingTabs.set(on);
  persistBool(INDENT_TABS_KEY, on);
}

/** R94 (㊺ 续续): Obsidian "Show inline title" — render the note's filename as an
 *  H1 at the top of the editor + reading view. Default ON = Obsidian's shipped
 *  default (a deliberate alignment; Geode had none). DISPLAY-ONLY in v1 — editing
 *  the title to rename the file is deferred. Consumed reactively by EditorPane. */
const INLINE_TITLE_KEY = "geode.showInlineTitle";
export const showInlineTitle = new Store<boolean>(readBool(INLINE_TITLE_KEY, true));

export function setShowInlineTitle(on: boolean): void {
  showInlineTitle.set(on);
  persistBool(INLINE_TITLE_KEY, on);
}

/** R94 (㊺ 续续): show the left ribbon (primary nav). Default ON = current behaviour
 *  + Obsidian default. OFF hides it; settings stay reachable via Ctrl+, / the command
 *  palette. Consumed reactively by App. */
const RIBBON_KEY = "geode.showRibbon";
export const showRibbon = new Store<boolean>(readBool(RIBBON_KEY, true));

export function setShowRibbon(on: boolean): void {
  showRibbon.set(on);
  persistBool(RIBBON_KEY, on);
}

/** R100 (㊺ 续续续): Obsidian "Show tab title bar" — show each pane's tab strip.
 *  Default ON = current behaviour + Obsidian default. OFF hides every tab bar (tabs
 *  stay switchable via Ctrl+Tab / the command palette). Consumed reactively by App. */
const TAB_TITLE_BAR_KEY = "geode.showTabTitleBar";
export const showTabTitleBar = new Store<boolean>(readBool(TAB_TITLE_BAR_KEY, true));

export function setShowTabTitleBar(on: boolean): void {
  showTabTitleBar.set(on);
  persistBool(TAB_TITLE_BAR_KEY, on);
}

/** R229 (G8): Obsidian "Show view mode toggle" — show the edit/read view-mode toggle button
 *  group on each tab's header. Default ON = current behaviour + Obsidian default. OFF hides it
 *  (the mode is still switchable via the Ctrl+E / Ctrl+Shift+E commands). Consumed reactively by
 *  EditorPane (gates the .editor-mode-group render). */
const VIEW_MODE_TOGGLE_KEY = "geode.showViewModeToggle";
export const showViewModeToggle = new Store<boolean>(readBool(VIEW_MODE_TOGGLE_KEY, true));

export function setShowViewModeToggle(on: boolean): void {
  showViewModeToggle.set(on);
  persistBool(VIEW_MODE_TOGGLE_KEY, on);
}

/** R231: Quick switcher settings (Obsidian core "Quick switcher"). All persisted, consumed by
 *  QuickSwitcher. existingOnly default OFF (create row shown = Geode prior); showAttachments
 *  default ON (Obsidian default — only adds rows when attachments exist, so zero-regression);
 *  showAllTypes default OFF. */
const SWITCHER_EXISTING_KEY = "geode.switcherShowExistingOnly";
export const switcherShowExistingOnly = new Store<boolean>(readBool(SWITCHER_EXISTING_KEY, false));
export function setSwitcherShowExistingOnly(on: boolean): void {
  switcherShowExistingOnly.set(on);
  persistBool(SWITCHER_EXISTING_KEY, on);
}

const SWITCHER_ATTACHMENTS_KEY = "geode.switcherShowAttachments";
export const switcherShowAttachments = new Store<boolean>(readBool(SWITCHER_ATTACHMENTS_KEY, true));
export function setSwitcherShowAttachments(on: boolean): void {
  switcherShowAttachments.set(on);
  persistBool(SWITCHER_ATTACHMENTS_KEY, on);
}

const SWITCHER_ALL_TYPES_KEY = "geode.switcherShowAllTypes";
export const switcherShowAllTypes = new Store<boolean>(readBool(SWITCHER_ALL_TYPES_KEY, false));
export function setSwitcherShowAllTypes(on: boolean): void {
  switcherShowAllTypes.set(on);
  persistBool(SWITCHER_ALL_TYPES_KEY, on);
}

/** R100 (㊺ 续续续): show the bottom status bar. Default ON. OFF hides it (status-bar
 *  plugin items like word count keep working — only the display is hidden). */
const STATUS_BAR_KEY = "geode.showStatusBar";
export const showStatusBar = new Store<boolean>(readBool(STATUS_BAR_KEY, true));

export function setShowStatusBar(on: boolean): void {
  showStatusBar.set(on);
  persistBool(STATUS_BAR_KEY, on);
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
