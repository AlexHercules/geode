/**
 * R34 in-editor find / replace — the command + probe layer over CodeMirror's
 * `@codemirror/search`. The `search()` extension + `searchKeymap` + localized
 * phrases are wired in cmExtensions.ts; this module registers the app commands
 * that OPEN the panel (so they show in the palette + are rebindable) and
 * installs the `__geodeSearch` runtime probe.
 *
 * Layering: features/editor may import core + app/AppContext + @codemirror/*.
 *
 * Hotkeys: `editor:search` = Mod+F (Obsidian-faithful). `editor:replace` has NO
 * default hotkey on purpose — macOS reserves Cmd+H for "Hide app" (and browsers
 * for history), so binding it is cross-platform unsafe; replace is still fully
 * reachable from the Cmd+F panel (which shows the replace row) and is palette-
 * bindable. (Deliberate deviation, noted in ARCHITECTURE "Round 34 additions".)
 *
 * Data safety: replace mutates the doc through normal CM transactions →
 * documents.ts dirty → autosave (NO new vault write path; B-class guards
 * inherited). `getView` resolves the ACTIVE-FILE view only (R23 DS-1).
 */
import {
  closeSearchPanel,
  openSearchPanel,
  replaceAll as cmReplaceAll,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { t, type I18nKey } from "@core/i18n";

/**
 * CodeMirror search-panel phrase map: CM's built-in English phrase keys →
 * localized strings. Consumed via `EditorState.phrases.of(...)` in
 * cmExtensions.ts. Resolved at view-build time, so a locale switch applies to
 * views built after it (R8 known CM-string limitation — consistent with the
 * editor placeholder / task aria labels).
 */
export function editorSearchPhrases(): Record<string, string> {
  const k = (key: I18nKey) => t(key);
  return {
    Find: k("editor.search.find"),
    Replace: k("editor.search.replace"),
    next: k("editor.search.next"),
    previous: k("editor.search.previous"),
    all: k("editor.search.all"),
    "match case": k("editor.search.matchCase"),
    regexp: k("editor.search.regexp"),
    "by word": k("editor.search.byWord"),
    replace: k("editor.search.replaceBtn"),
    "replace all": k("editor.search.replaceAll"),
    close: k("editor.search.close"),
    "current match": k("editor.search.currentMatch"),
    "Go to line": k("editor.search.gotoLine"),
    go: k("editor.search.go"),
    "on line": k("editor.search.onLine"),
    "replaced match on line $": k("editor.search.replacedOnLine"),
    "replaced $ matches": k("editor.search.replacedMatches"),
  };
}

/** Focus the panel's replace field after it opens (the CM panel always focuses
 *  the find field; editor:replace re-focuses replace so the user lands there). */
function focusReplaceField(view: EditorView): void {
  requestAnimationFrame(() => {
    const el = view.dom.querySelector<HTMLInputElement>('.cm-search [name="replace"]');
    el?.focus();
    el?.select();
  });
}

/**
 * Register the R34 find/replace commands. `getView` returns the active-FILE
 * editor view or null; commands are unavailable (palette hides them, hotkey
 * skips them) when no editor is active. Returns disposers.
 */
export function registerSearchCommands(
  app: GeodeApp,
  getView: () => EditorView | null,
): Array<() => void> {
  return [
    app.commands.register({
      id: "editor:search",
      name: () => t("cmd.searchFile"),
      hotkey: "Mod+F",
      available: () => getView() !== null,
      callback: () => {
        const view = getView();
        if (!view) return;
        openSearchPanel(view);
      },
    }),
    app.commands.register({
      id: "editor:replace",
      name: () => t("cmd.replaceFile"),
      // no default hotkey — see module header (macOS Cmd+H = Hide)
      available: () => getView() !== null,
      callback: () => {
        const view = getView();
        if (!view) return;
        openSearchPanel(view);
        focusReplaceField(view);
      },
    }),
  ];
}

/**
 * Install the always-on `window.__geodeSearch` probe (R34) — drives the search
 * panel + replace on the active view from browser/desktop E2E (WKWebView has no
 * CDP; same pattern as `__geodeFormat`/`__geodeHotkey`). Must be called BEFORE
 * `plugins.loadExternal` so an external plugin's onload can capture it.
 */
export function installSearchProbe(app: GeodeApp): void {
  // ACTIVE-FILE gated (R23 DS-1): the latched active-view field can go stale (a
  // background pane's editor while a non-editor tab is active) — replace through
  // it would mutate a NON-active file. Mirror getActiveFileEditorView so this
  // production global can never write the wrong file (R34 review fix).
  const view = (): EditorView | null => {
    const active = app.documents.getActiveView();
    if (!active || active.path !== app.workspace.getActiveFile()) return null;
    return active.view;
  };
  const host = globalThis as typeof globalThis & {
    __geodeSearch?: {
      open: () => boolean;
      isOpen: () => boolean;
      close: () => boolean;
      replaceAll: (search: string, replace: string) => string | null;
    };
  };
  host.__geodeSearch = {
    open: () => {
      const v = view();
      if (!v) return false;
      openSearchPanel(v);
      return searchPanelOpen(v.state);
    },
    isOpen: () => {
      const v = view();
      return v ? searchPanelOpen(v.state) : false;
    },
    close: () => {
      const v = view();
      if (!v) return false;
      closeSearchPanel(v);
      return searchPanelOpen(v.state);
    },
    replaceAll: (search, replace) => {
      const v = view();
      if (!v) return null;
      // empty search = no-op: an invalid SearchQuery makes cmReplaceAll fall
      // through to openSearchPanel (R34 review fix) — return the doc unchanged.
      if (search === "") return v.state.doc.toString();
      v.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search, replace })) });
      cmReplaceAll(v);
      return v.state.doc.toString();
    },
  };
}
