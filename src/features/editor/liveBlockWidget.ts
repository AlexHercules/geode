/**
 * R56 — shared cursor-aware block-widget machinery, extracted from R55 live tables so
 * #⑱ live-render items (tables, mermaid, …) reuse one implementation.
 *
 * A `spec.ranges(state)` yields document-order block ranges; each line-aligned range
 * the selection is NOT inside is REPLACED by `spec.widget(source, from)` (a block
 * widget). Selection-inside → no widget (source shows for editing). Block decorations
 * MUST come from a StateField — a ViewPlugin block decoration crashes the DocView
 * (`RangeSet.spans`, R55). atomicRanges keeps the caret from parking inside the
 * replaced range (mirrors the frontmatter field). The document is never modified —
 * the widget is a pure view layer; the source is always one selection/click away.
 */
import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, type WidgetType } from "@codemirror/view";

export interface BlockWidgetSpec {
  /** eligible block ranges, document-order with ascending `from` (RangeSetBuilder) */
  ranges: (state: EditorState) => Array<{ from: number; to: number }>;
  /** the block widget for a range whose source is `state.sliceDoc(from, to)` */
  widget: (source: string, from: number) => WidgetType;
}

function buildDecos(state: EditorState, spec: BlockWidgetSpec): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sel = state.selection.ranges;
  for (const { from, to } of spec.ranges(state)) {
    // a block-replace decoration must be line-aligned; a node nested in a blockquote /
    // list / indentation starts mid-line, and a mid-line block widget corrupts the
    // view (R55 review) — skip it, keeping its source.
    if (from !== state.doc.lineAt(from).from) continue;
    // reveal source (no widget) when a cursor/selection touches the block
    if (sel.some((r) => r.from <= to && r.to >= from)) continue;
    builder.add(
      from,
      to,
      Decoration.replace({ widget: spec.widget(state.sliceDoc(from, to), from), block: true }),
    );
  }
  return builder.finish();
}

/** A live-preview block-widget extension built from `spec`. Rebuilds on doc/selection
 *  change so entering/leaving a block toggles render↔source. */
export function liveBlockWidgets(spec: BlockWidgetSpec): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildDecos(state, spec),
    update: (value, tr) =>
      tr.docChanged || tr.selection ? buildDecos(tr.state, spec) : value.map(tr.changes),
    provide: (f) => [
      EditorView.decorations.from(f),
      EditorView.atomicRanges.of((view) => view.state.field(f, false) ?? Decoration.none),
    ],
  });
  return field;
}
