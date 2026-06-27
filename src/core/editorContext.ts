/**
 * R260: per-view editor-context facets — the layering bridge that lets the
 * obsidian-compat CM6 StateFields (editorInfoField / editorLivePreviewField /
 * editorEditorField, in compat/obsidian/editorFields.ts) read THIS view's file
 * path and live-preview mode.
 *
 * Layering: core DEFINES (may import @codemirror/*), features/editor PROVIDES the
 * per-view values (it owns the EditorView build + the live↔source mode reconfigure),
 * compat READS them inside its StateFields. Same shape as the core/editorExtensions.ts
 * registry bridge — compat may not import features, nor features compat.
 */
import { Facet } from "@codemirror/state";

/** The active file path of this editor view, as a rename-safe closure (the handle is
 *  retargeted in place on file:renamed, so calling it always yields the live path).
 *  compat's editorInfoField reads it to resolve the current TFile. */
export const editorPathFacet = Facet.define<() => string, () => string>({
  combine: (values) => values[0] ?? (() => ""),
});

/** Whether this view is in live-preview mode (true) vs source mode (false). Provided
 *  by editorModeExtensions INSIDE the mode compartment, so a live↔source reconfigure
 *  re-provides it; compat's editorLivePreviewField mirrors it reactively. */
export const editorLivePreviewModeFacet = Facet.define<boolean, boolean>({
  combine: (values) => (values.length > 0 ? values[0] : false),
});
