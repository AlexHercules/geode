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

/**
 * Navigate the link under the cursor. `newTab` opens it in a fresh tab
 * (editor:open-link-in-new-leaf). Returns false when there is no link there.
 *  - wikilink → openWikilink (resolved → open + #reveal; unresolved → create-note).
 *  - markdown external (URL scheme) → window.open (Tauri routes to the OS browser).
 *  - markdown internal → resolveMarkdownLink → openFile + #reveal.
 */
export function followLinkAtCursor(
  app: GeodeApp,
  view: EditorView,
  fromPath: string,
  newTab: boolean,
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
  if (link.kind === "wikilink") {
    void openWikilink(app, link.target, fromPath, link.subpath || undefined, { newTab });
    return true;
  }
  if (link.external) {
    // a new tab is meaningless for an external URL — always open the OS browser
    const url = link.subpath ? `${link.target}#${link.subpath}` : link.target;
    window.open(url, "_blank", "noopener");
    return true;
  }
  const resolved = app.metadata.resolveMarkdownLink(link.target, fromPath);
  if (!resolved) return false;
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
  newTab: boolean;
}

const LINK_COMMANDS: ReadonlyArray<LinkCommandSpec> = [
  { id: "editor:follow-link", nameKey: "cmd.followLink", hotkey: "Alt+Enter", newTab: false },
  { id: "editor:open-link-in-new-leaf", nameKey: "cmd.openLinkNewLeaf", hotkey: "Mod+Enter", newTab: true },
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
        if (active) followLinkAtCursor(app, active.view, active.path, spec.newTab);
      },
    }),
  );
}
