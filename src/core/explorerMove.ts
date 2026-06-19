/**
 * File-tree drag-to-move decision core (R28). Pure tree/path logic — no React,
 * no DOM. Lives in core so BOTH the Explorer drop handler and the
 * `__geodeExplorerMove` E2E probe (main.tsx) share a single source of truth for
 * the guards, without the bootstrap reaching into a feature.
 * Contract: ARCHITECTURE.md "Round 28 additions".
 */
import type { FolderNode } from "./types";
import { basename, parentPath } from "./vault";

/** MIME tag carried by an explorer drag (lowercased by the DnD layer). */
export const EXPLORER_MIME = "application/x-geode-path";

/** Resolve a folder node by vault-relative path ("" = root), or null if the
 *  path isn't a folder (a file path or a missing path → null). */
export function findFolder(root: FolderNode, path: string): FolderNode | null {
  if (path === "") return root;
  const walk = (folder: FolderNode): FolderNode | null => {
    for (const child of folder.children) {
      if (child.kind !== "folder") continue;
      if (child.path === path) return child;
      if (path.startsWith(child.path + "/")) return walk(child);
    }
    return null;
  };
  return walk(root);
}

/**
 * Structural drop-target resolution (R28). Returns the destination FOLDER path
 * a move would land in, or `null` when the move is a no-op or illegal:
 *  - hovering a folder → that folder; a file → its parent; empty space → root ("")
 *  - no-op guard: already in that folder (drop on sibling / own parent / own row)
 *  - self/descendant guard: a folder may not move into itself or a descendant
 * Collision is NOT judged here (it must not suppress the hover highlight — see
 * `wouldCollide`, checked at drop time so the user gets a notice).
 */
export function resolveDropTarget(
  tree: FolderNode,
  draggedPath: string,
  hoveredPath: string | null,
): string | null {
  // hovered file → its parent folder; hovered folder → itself; empty space → root
  const targetFolder =
    hoveredPath === null
      ? ""
      : findFolder(tree, hoveredPath) !== null
        ? hoveredPath
        : parentPath(hoveredPath);
  if (targetFolder === parentPath(draggedPath)) return null; // no-op: already there
  const draggedIsFolder = findFolder(tree, draggedPath) !== null;
  if (
    draggedIsFolder &&
    (targetFolder === draggedPath || targetFolder.startsWith(draggedPath + "/"))
  ) {
    return null; // into self / own descendant
  }
  return targetFolder;
}

/**
 * R97 (㊽ 续续续续): the VALID folder targets for moving `fromPath` (the "Move to…"
 * picker candidate list). All folders in the tree EXCEPT — the current parent (a no-op
 * move), and (when `fromPath` is itself a folder) `fromPath` and its descendants (a move
 * into self). Root ("") is offered separately by the picker. Depth-first tree order.
 */
export function moveTargets(tree: FolderNode, fromPath: string): string[] {
  const fromIsFolder = findFolder(tree, fromPath) !== null;
  const parent = parentPath(fromPath);
  const out: string[] = [];
  const walk = (folder: FolderNode) => {
    for (const child of folder.children) {
      if (child.kind !== "folder") continue;
      const p = child.path;
      const selfOrDescendant = fromIsFolder && (p === fromPath || p.startsWith(fromPath + "/"));
      if (!selfOrDescendant && p !== parent) out.push(p);
      walk(child);
    }
  };
  walk(tree);
  return out;
}

/** Does `targetFolder` already hold a child with the dragged item's name?
 *  (case-insensitive, mirrors `validateName`). Checked at drop → notice, never
 *  blind-overwrite. */
export function wouldCollide(
  tree: FolderNode,
  draggedPath: string,
  targetFolder: string,
): boolean {
  const name = basename(draggedPath).toLowerCase();
  const siblings = findFolder(tree, targetFolder)?.children ?? [];
  return siblings.some((c) => c.path !== draggedPath && c.name.toLowerCase() === name);
}
