/**
 * R210: per-note folded state for the properties panel (Obsidian "toggle
 * properties folding"). Pure VIEW state — folding never mutates the document.
 * Keyed by file path; in-memory (resets on restart; Obsidian persists fold state
 * in the workspace — deferred). Consumed by PropertiesPanel (render) and the
 * editor:toggle-fold-properties command (toggle).
 */
import { Store } from "@core/store";

export const foldedPropertiesPaths = new Store<ReadonlySet<string>>(new Set());

/** Toggle the folded state for one note path (immutable update so the Store notifies). */
export function togglePropertiesFold(path: string): void {
  const next = new Set(foldedPropertiesPaths.get());
  if (next.has(path)) next.delete(path);
  else next.add(path);
  foldedPropertiesPaths.set(next);
}
