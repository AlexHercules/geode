import type { GeodeApp } from "@app/AppContext";
import { basename, stripExtension } from "@core/vault";

/**
 * Navigate to a wikilink target from a given file.
 * - Resolved link  → open the existing note.
 * - Unresolved link → create a new note at the vault root (unique name,
 *   "# <name>" seed content) and open it — Obsidian behaviour.
 */
export async function openWikilink(app: GeodeApp, target: string, fromPath: string): Promise<void> {
  const resolved = app.metadata.resolveLink(target, fromPath);
  if (resolved) {
    app.workspace.openFile(resolved);
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

/** Extract the link target from the inside of a [[...]] span (drops alias + heading). */
export function wikilinkTarget(inner: string): string {
  return inner.split("|")[0].split("#")[0].trim();
}
