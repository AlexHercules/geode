/**
 * R260: the obsidian CM6 editor StateFields —
 *   - editorInfoField:        StateField<MarkdownFileInfo>  (the owning file-info)
 *   - editorEditorField:      StateField<EditorView>        (the raw CM6 view)
 *   - editorLivePreviewField: StateField<boolean>           (live-preview vs source)
 *   - editorViewField:        deprecated alias of editorInfoField
 *
 * Real plugins read these from inside their OWN CM6 extension —
 * `view.state.field(editorInfoField).file`, `view.state.field(editorLivePreviewField)`
 * to gate live-preview-only rendering, `view.state.field(editorEditorField)` to recover
 * the view from a bare EditorState. Populated from the R260 core facets
 * (editorPathFacet / editorLivePreviewModeFacet) that features/editor provides per view.
 *
 * Registered always-on via the R115 core editor-extension registry (context.ts), so it
 * applies to every markdown editor (Obsidian semantics) without features/editor importing
 * compat.
 */
import { Facet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import { editorLivePreviewModeFacet, editorPathFacet } from "@core/editorContext";
import { Editor } from "./editor";
import type { FileRegistry } from "./files";
import type { App } from "./plugin";
import type { MarkdownFileInfo } from "./workspace";

/** Per-context host (App + file registry) for building a MarkdownFileInfo. Provided by
 *  editorFieldsExtension so the MODULE-LEVEL editorInfoField.create() can build a NON-NULL
 *  info synchronously (R264) — the field instance is shared with plugins, but app/registry
 *  are per-compat-context, so they ride in on this facet. */
interface EditorInfoHost {
  app: App;
  registry: FileRegistry;
}
const editorInfoHostFacet = Facet.define<EditorInfoHost, EditorInfoHost | null>({
  combine: (values) => values[0] ?? null,
});

/** Build the light MarkdownFileInfo. `editor` is set only when a view is available (it needs
 *  one): the StateField.create() path has no view yet, so it omits editor; the ViewPlugin then
 *  re-seeds the full info (with editor) via a microtask. The `file` getter works in both. */
function makeFileInfo(host: EditorInfoHost, getPath: () => string, view: EditorView | null): MarkdownFileInfo {
  return {
    app: host.app,
    get file() {
      return host.registry.getFile(getPath());
    },
    editor: view ? new Editor(view) : undefined,
    hoverPopover: null, // MarkdownFileInfo extends HoverParent (R25 hover stub)
  };
}

/** d.ts `editorLivePreviewField: StateField<boolean>` — mirrors the per-view live-preview
 *  mode facet (source mode → false); reactive (re-reads on every transaction, so a
 *  live↔source mode reconfigure flips it). */
export const editorLivePreviewField = StateField.define<boolean>({
  create: (state) => state.facet(editorLivePreviewModeFacet),
  update: (_value, tr) => tr.state.facet(editorLivePreviewModeFacet),
});

/** d.ts `editorEditorField: StateField<EditorView>` — the raw CM6 view (null until the
 *  populating ViewPlugin's first microtask sets it; plugins read it from update()). */
const setEditorView = StateEffect.define<EditorView>();
export const editorEditorField = StateField.define<EditorView | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setEditorView)) return e.value;
    return value;
  },
});

/** d.ts `editorInfoField: StateField<MarkdownFileInfo>` — a light `{ app, get file(), editor }`
 *  (the d.ts MarkdownFileInfo interface; not a full MarkdownView).
 *
 *  R264: NON-NULL from create() (was null until the ViewPlugin's microtask). Real plugins read
 *  `field(editorInfoField).file` UNGUARDED from their OWN extension's construction, which runs
 *  BEFORE our seeding microtask — a null field crashed the whole editor (Dataview inline queries:
 *  "Cannot read properties of null (reading 'file')"). create() now builds the info from the host
 *  facet (editor omitted — no view yet); the ViewPlugin still re-seeds the full info (with editor)
 *  once it has the view. */
const setEditorInfo = StateEffect.define<MarkdownFileInfo>();
export const editorInfoField = StateField.define<MarkdownFileInfo | null>({
  create(state) {
    const host = state.facet(editorInfoHostFacet);
    return host ? makeFileInfo(host, state.facet(editorPathFacet), null) : null;
  },
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setEditorInfo)) return e.value;
    return value;
  },
});

/** d.ts: deprecated alias of editorInfoField. */
export const editorViewField = editorInfoField;

/**
 * The always-on extension (registered in context.ts with the current App + registry,
 * re-registered per compat context on loader reload so app/registry stay current).
 * Ships the three StateFields + a ViewPlugin that builds ONE stable Editor per view and
 * seeds editorEditorField + editorInfoField via an effect-only transaction.
 */
export function editorFieldsExtension(app: App, registry: FileRegistry): Extension {
  const host: EditorInfoHost = { app, registry };
  return [
    editorInfoHostFacet.of(host),
    editorLivePreviewField,
    editorEditorField,
    editorInfoField,
    ViewPlugin.fromClass(
      class {
        private destroyed = false;
        constructor(view: EditorView) {
          // editorInfoField.create() already seeded a non-null info (no editor — no view yet);
          // re-seed the FULL info (with the editor) now that we have the view. CM6 forbids
          // dispatching during view construction → queue an effect-only microtask. Plugins read
          // these fields from their own update()/decoration provider (which runs after this
          // microtask), and the dispatch carries no doc change → no docChanged → no autosave
          // (data-safety: 底线① untouched).
          const info = makeFileInfo(host, view.state.facet(editorPathFacet), view);
          queueMicrotask(() => {
            if (this.destroyed) return;
            view.dispatch({ effects: [setEditorView.of(view), setEditorInfo.of(info)] });
          });
        }
        destroy() {
          this.destroyed = true;
        }
      },
    ),
  ];
}
