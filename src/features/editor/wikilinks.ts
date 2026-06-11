import type { GeodeApp } from "@app/AppContext";
import { wikilinkTarget } from "@core/markdown";
import { basename, stripExtension } from "@core/vault";

export { wikilinkTarget };

/**
 * Navigate to a wikilink target from a given file.
 * - Resolved link  → open the existing note. When a `subpath` (the raw text
 *   after "#" in `[[note#Heading]]` / `[[note#^id]]`) resolves to a span in
 *   the target note, request a one-shot reveal (scroll + flash) AFTER the
 *   openFile so the consuming pane already targets the path (R14).
 * - Unresolved link → create a new note at the vault root (unique name,
 *   "# <name>" seed content) and open it — Obsidian behaviour.
 * - Empty target + subpath (`[[#Heading]]` / `[[#^id]]`, R16) → the link
 *   points at the source note itself: open fromPath (a no-op when already
 *   active) and reveal the subpath span. NEVER the create-note branch.
 */
export async function openWikilink(
  app: GeodeApp,
  target: string,
  fromPath: string,
  subpath?: string,
): Promise<void> {
  if (target === "") {
    if (!subpath) return; // defensive: an empty link never navigates/creates
    app.workspace.openFile(fromPath);
    const span = app.metadata.resolveSubpath(fromPath, subpath);
    if (span) app.workspace.requestReveal(fromPath, span.from, span.to);
    return;
  }
  const resolved = app.metadata.resolveLink(target, fromPath);
  if (resolved) {
    app.workspace.openFile(resolved);
    if (subpath) {
      const span = app.metadata.resolveSubpath(resolved, subpath);
      if (span) app.workspace.requestReveal(resolved, span.from, span.to);
    }
    return;
  }
  const name = stripExtension(basename(target.trim())).trim() || "Untitled";
  const path = app.vault.uniquePath("", name);
  try {
    await app.vault.create(path, `# ${name}\n`);
    app.workspace.openFile(path);
  } catch (err) {
    console.error(`[editor] failed to create note for link "${target}"`, err);
  }
}
