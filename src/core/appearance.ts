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

/** Apply DOM-affecting appearance settings on boot (call once the document exists). */
export function applyAppearanceSettings(): void {
  applyReadableLineLength(readableLineLength.get());
}
