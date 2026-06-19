/**
 * R115 — global registry of plugin-contributed CodeMirror 6 editor extensions,
 * backing the Obsidian-compat `Plugin.registerEditorExtension`. A registered
 * extension applies to EVERY markdown editor view (Obsidian semantics).
 *
 * Layering bridge: `registerEditorExtension` is global, but CM compartments live
 * per-view inside features/editor — and compat may NOT import features (nor
 * features compat). So this CORE module is the meeting point: compat writes
 * (register/dispose), features/editor reads (`getEditorExtensions`) + subscribes
 * to `editorExtensionsRevision` to reconfigure each open view's compat compartment.
 *
 * Core may import `@codemirror/*` (CLAUDE.md layering rule); the registry holds
 * the opaque `Extension` values without interpreting them.
 */
import type { Extension } from "@codemirror/state";
import { Store } from "./store";

const registered: Extension[] = [];

/** Bumped on every (un)register so each mounted EditorPane reconfigures its
 *  compat compartment across ALL open views (mirrors CommandRegistry.revision). */
export const editorExtensionsRevision = new Store(0);

/** Register a CM6 extension for all markdown editors; returns a disposer that
 *  removes exactly this registration (plugin unload calls it via Component). */
export function registerEditorExtension(extension: Extension): () => void {
  registered.push(extension);
  editorExtensionsRevision.update((n) => n + 1);
  return () => {
    const i = registered.indexOf(extension);
    if (i === -1) return; // already disposed — idempotent
    registered.splice(i, 1);
    editorExtensionsRevision.update((n) => n + 1);
  };
}

/** Snapshot of the currently-registered extensions — a fresh array each call so
 *  callers (compartment seed / reconfigure) never alias the internal list. */
export function getEditorExtensions(): Extension[] {
  return registered.slice();
}
