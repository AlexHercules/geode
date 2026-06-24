/**
 * R201: editor link-navigation commands — editor:follow-link (⌥Enter) and
 * editor:open-link-in-new-leaf (⌘Enter). Both resolve the link under the cursor
 * (core/linkAtCursor) and open it, differing only in `newTab`. Pure navigation:
 * reuses the vetted openWikilink (incl. its unresolved→createNewNote branch),
 * metadata.resolveMarkdownLink and window.open — no new vault write path.
 */
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { GeodeApp } from "@app/AppContext";
import { linkAtCursor } from "@core/linkAtCursor";
import { t, type I18nKey } from "@core/i18n";
import { openWikilink } from "./wikilinks";

interface ActiveView {
  view: EditorView;
  path: string;
}

/** Where to open the followed link: the current pane, a new tab, or a new split. */
export type FollowMode = "current" | "tab" | "split";

/**
 * Navigate the link under the cursor. `mode` picks the destination: the current
 * pane (editor:follow-link), a new tab (open-link-in-new-leaf), or a new split to
 * the right (open-link-in-new-split). Returns false when there is no link there.
 *  - wikilink → openWikilink (resolved → open + #reveal; unresolved → create-note).
 *  - markdown external (URL scheme) → window.open (Tauri routes to the OS browser).
 *  - markdown internal → resolveMarkdownLink → openFile + #reveal.
 * For split mode, splitActivePane("row") makes the new pane active first, so the
 * subsequent open lands there. The link is read from the original view BEFORE the split.
 */
export function followLinkAtCursor(
  app: GeodeApp,
  view: EditorView,
  fromPath: string,
  mode: FollowMode,
): boolean {
  const pos = view.state.selection.main.head;
  // A `[[link]]` / `[..]()` that is literal text inside inline code or a code fence is
  // NOT a link in the reading view — don't follow it (an unresolved wikilink would
  // otherwise CREATE a phantom note). Reading Lezer node NAMES only is safe here — we
  // never act on emphasis marks (the "Lezer ≠ Geode overlays" rule, R192/R197).
  for (let n = syntaxTree(view.state).resolveInner(pos, -1); ; ) {
    if (n.name.includes("Code")) return false;
    const parent = n.parent;
    if (!parent) break;
    n = parent;
  }
  const line = view.state.doc.lineAt(pos);
  const link = linkAtCursor(line.text, line.from, pos);
  if (!link) return false;
  const newTab = mode === "tab";
  if (link.external) {
    // a tab/split is meaningless for an external URL — always open the OS browser
    const url = link.subpath ? `${link.target}#${link.subpath}` : link.target;
    window.open(url, "_blank", "noopener");
    return true;
  }
  if (link.kind === "wikilink") {
    // a degenerate `[[#]]` / `[[#|x]]` (empty target + empty subpath) never navigates —
    // bail BEFORE the split so it can't leave a useless duplicate pane (openWikilink no-ops on it).
    if (link.target === "" && !link.subpath) return false;
    if (mode === "split") app.workspace.splitActivePane("row");
    void openWikilink(app, link.target, fromPath, link.subpath || undefined, { newTab });
    return true;
  }
  // markdown internal: resolve FIRST so an unresolved link never leaves an empty split
  const resolved = app.metadata.resolveMarkdownLink(link.target, fromPath);
  if (!resolved) return false;
  if (mode === "split") app.workspace.splitActivePane("row");
  app.workspace.openFile(resolved, { newTab });
  if (link.subpath) {
    const span = app.metadata.resolveSubpath(resolved, link.subpath);
    if (span) app.workspace.requestReveal(resolved, span.from, span.to);
  }
  return true;
}

interface LinkCommandSpec {
  id: string;
  nameKey: I18nKey;
  hotkey: string;
  mode: FollowMode;
}

const LINK_COMMANDS: ReadonlyArray<LinkCommandSpec> = [
  { id: "editor:follow-link", nameKey: "cmd.followLink", hotkey: "Alt+Enter", mode: "current" },
  { id: "editor:open-link-in-new-leaf", nameKey: "cmd.openLinkNewLeaf", hotkey: "Mod+Enter", mode: "tab" },
  // R202: open in a new split to the right (Obsidian ⌘⌥Enter "Open link under cursor to the right")
  { id: "editor:open-link-in-new-split", nameKey: "cmd.openLinkNewSplit", hotkey: "Mod+Alt+Enter", mode: "split" },
];

/**
 * Register editor:follow-link / editor:open-link-in-new-leaf. `getActive` returns the
 * active-FILE editor view + its path (R23 DS-1), or null when unavailable (the command
 * is hidden / the hotkey is skipped).
 */
export function registerLinkCommands(
  app: GeodeApp,
  getActive: () => ActiveView | null,
): Array<() => void> {
  return LINK_COMMANDS.map((spec) =>
    app.commands.register({
      id: spec.id,
      name: () => t(spec.nameKey),
      hotkey: spec.hotkey,
      available: () => getActive() !== null,
      callback: () => {
        const active = getActive();
        if (active) followLinkAtCursor(app, active.view, active.path, spec.mode);
      },
    }),
  );
}
