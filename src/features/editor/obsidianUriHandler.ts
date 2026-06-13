/**
 * R46: obsidian:// URI executor — runs a parsed ObsidianAction against the app
 * (open file/heading/block, create note, search). Bridges the pure parser
 * (core/obsidianUri) to live app actions. Reused by the EditorPane in-app link
 * router and the __geodeUri probe; a future OS deep-link handler can call this too.
 *
 * Layering: features/editor may import core + app/AppContext. open reuses
 * openWikilink (resolution + #heading/#^block reveal). vault param is NOT
 * enforced (single-vault in-app handling; cross-vault routing is OS deep-link).
 */
import type { GeodeApp } from "@app/AppContext";
import { parseObsidianUri } from "@core/obsidianUri";
import { openWikilink } from "./wikilinks";

/** Parse + execute an obsidian:// URI. Returns true if it was a handled action. */
export async function handleObsidianUri(app: GeodeApp, uri: string): Promise<boolean> {
  const action = parseObsidianUri(uri);
  if (!action) return false;
  switch (action.kind) {
    case "open": {
      // `||` not `??`: a present-but-empty `file=` must fall through to path (R46 review).
      const target = action.file || action.path;
      if (!target) return false;
      const from = app.workspace.getActiveFile() ?? "";
      // obsidian://open opens EXISTING notes only — unlike a wikilink click it must
      // never CREATE a note for a missing/cross-vault target (R46 review).
      if (app.metadata.resolveLink(target, from) === null) return false;
      const subpath = action.heading ? "#" + action.heading : action.block ? "#^" + action.block : undefined;
      await openWikilink(app, target, from, subpath);
      return true;
    }
    case "new": {
      const raw = action.file || action.name; // `||` not `??` (R46 review)
      if (!raw) return false;
      const path = /\.md$/i.test(raw) ? raw : raw + ".md";
      if (!app.vault.fileExists(path)) {
        try {
          await app.vault.create(path, action.content ?? "");
        } catch (err) {
          console.error("[obsidian-uri] new failed to create note", err);
        }
      }
      // only open if it actually exists — a rejected/failed create (unsafe path,
      // illegal name) must not leave a ghost tab on a non-existent file (R46 review).
      if (!app.vault.fileExists(path)) return false;
      app.workspace.openFile(path);
      return true;
    }
    case "search":
      app.workspace.requestSearch(action.query ?? "");
      return true;
    default:
      return false;
  }
}
