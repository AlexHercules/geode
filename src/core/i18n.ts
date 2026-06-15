import { Store, useStore } from "./store";
import * as dictAllProperties from "./i18n/dict.allproperties";
import * as dictApp from "./i18n/dict.app";
import * as dictBookmarks from "./i18n/dict.bookmarks";
import * as dictPanels from "./i18n/dict.panels";
import * as dictQuery from "./i18n/dict.query";
import * as dictSlides from "./i18n/dict.slides";
import * as dictViews from "./i18n/dict.views";

/**
 * i18n (R8) — centralized UI strings, en/zh.
 *
 * Dictionaries are merged from per-agent fragment files (core/i18n/dict.*.ts);
 * keys are namespaced ("explorer.newNote"). `t()` resolves against the current
 * locale with en fallback and never throws — a missing key renders as itself.
 *
 * This module is the second hooks exception in core besides store.ts
 * (one React hook, no components).
 */

export type Locale = "en" | "zh";

const en = {
  ...dictApp.en,
  ...dictPanels.en,
  ...dictViews.en,
  ...dictBookmarks.en,
  ...dictAllProperties.en,
  ...dictSlides.en,
  ...dictQuery.en,
};
const zh: Record<string, string> = {
  ...dictApp.zh,
  ...dictPanels.zh,
  ...dictViews.zh,
  ...dictBookmarks.zh,
  ...dictAllProperties.zh,
  ...dictSlides.zh,
  ...dictQuery.zh,
};

export type I18nKey = keyof typeof en;

const STORAGE_KEY = "geode.locale";

function detectInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    // storage unavailable — fall through to navigator detection
  }
  try {
    if ((navigator.language ?? "").toLowerCase().startsWith("zh")) return "zh";
  } catch {
    // no navigator (non-browser context) — default en
  }
  return "en";
}

/** Current UI locale. Subscribe via useStore / useI18n to re-render on switch. */
export const locale = new Store<Locale>(detectInitialLocale());

export function setLocale(l: Locale): void {
  locale.set(l);
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    // storage unavailable — locale stays session-local
  }
}

/** Translate a key: current locale → en fallback → the key itself.
 *  `params` interpolate "{name}"-style placeholders. */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  const primary = locale.get() === "zh" ? zh[key] : undefined;
  let text = primary ?? (en as Record<string, string>)[key] ?? String(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

/** React hook: subscribes to the locale store and returns `t`, so components
 *  using it re-render when the language changes. */
export function useI18n(): typeof t {
  useStore(locale);
  return t;
}
