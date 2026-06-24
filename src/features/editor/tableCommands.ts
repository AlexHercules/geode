/**
 * R206: GFM table structural-edit commands (Obsidian §17 table editor, 片 A).
 * Insert/delete row & column on the table the cursor sits in. The cursor's table
 * is located via the vetted R55 `findTableRanges` (Lezer Table node → code fences
 * are FencedCode, never Table, so a `|...|` inside a fence is correctly skipped);
 * the structural transform + serialization live in the pure `core/tableEditor`.
 * Each command rewrites the whole table in a single transaction (undo-atomic) and
 * drops the caret in the affected cell. No default hotkeys (Obsidian leaves them
 * unset). Whole-table replace touches .md bytes → data-safety 逻辑档.
 */
import { EditorView } from "@codemirror/view";
import type { GeodeApp } from "@app/AppContext";
import { t, type I18nKey } from "@core/i18n";
import { applyTableOp, type TableOp } from "@core/tableEditor";
import { findTableRanges } from "./liveTables";

interface TableCommandSpec {
  id: string;
  nameKey: I18nKey;
  op: TableOp;
}

const TABLE_COMMANDS: TableCommandSpec[] = [
  { id: "editor:table-insert-row-above", nameKey: "cmd.tableInsertRowAbove", op: "insert-row-above" },
  { id: "editor:table-insert-row-below", nameKey: "cmd.tableInsertRowBelow", op: "insert-row-below" },
  { id: "editor:table-insert-column-left", nameKey: "cmd.tableInsertColumnLeft", op: "insert-column-left" },
  { id: "editor:table-insert-column-right", nameKey: "cmd.tableInsertColumnRight", op: "insert-column-right" },
  { id: "editor:table-delete-row", nameKey: "cmd.tableDeleteRow", op: "delete-row" },
  { id: "editor:table-delete-column", nameKey: "cmd.tableDeleteColumn", op: "delete-column" },
  // R207 (片 B): duplicate / move / align
  { id: "editor:table-copy-row", nameKey: "cmd.tableCopyRow", op: "copy-row" },
  { id: "editor:table-copy-column", nameKey: "cmd.tableCopyColumn", op: "copy-column" },
  { id: "editor:table-move-row-up", nameKey: "cmd.tableMoveRowUp", op: "move-row-up" },
  { id: "editor:table-move-row-down", nameKey: "cmd.tableMoveRowDown", op: "move-row-down" },
  { id: "editor:table-move-column-left", nameKey: "cmd.tableMoveColumnLeft", op: "move-column-left" },
  { id: "editor:table-move-column-right", nameKey: "cmd.tableMoveColumnRight", op: "move-column-right" },
  { id: "editor:table-align-left", nameKey: "cmd.tableAlignLeft", op: "align-left" },
  { id: "editor:table-align-right", nameKey: "cmd.tableAlignRight", op: "align-right" },
  { id: "editor:table-align-center", nameKey: "cmd.tableAlignCenter", op: "align-center" },
];

/** Apply a table op at the cursor; no-op (returns false) if the cursor isn't in a table. */
function runTableOp(view: EditorView, op: TableOp): boolean {
  const pos = view.state.selection.main.head;
  const range = findTableRanges(view.state).find((r) => pos >= r.from && pos <= r.to);
  if (!range) return false;
  const tableText = view.state.doc.sliceString(range.from, range.to);
  const result = applyTableOp(op, tableText, pos - range.from);
  if (!result) return false;
  // findTableRanges starts the range at the header's first pipe, so a list-nested
  // / indented table's leading indent sits BEFORE range.from on the header line but
  // is part of [from,to] on every other row. The pure model serializes flush-left,
  // so we must re-apply the indent to every row or the delimiter/body rows lose it
  // and the table collapses (底线① — mutating non-cursor lines). We extend the
  // replace to the line start and prefix every serialized line with that indent.
  const headerLineFrom = view.state.doc.lineAt(range.from).from;
  const indent = view.state.doc.sliceString(headerLineFrom, range.from);
  let from = range.from;
  let insert = result.text;
  let cursor = result.cursorOffsetInTable;
  if (indent.length > 0 && /^[ \t]+$/.test(indent)) {
    from = headerLineFrom;
    insert = insert.split("\n").map((line) => indent + line).join("\n");
    // each line before (and including) the caret's line gained `indent.length`
    const linesBeforeCaret = result.text.slice(0, result.cursorOffsetInTable).split("\n").length;
    cursor = result.cursorOffsetInTable + indent.length * linesBeforeCaret;
  }
  view.dispatch({
    changes: { from, to: range.to, insert },
    selection: { anchor: from + cursor },
    scrollIntoView: true,
    userEvent: "input.table",
  });
  view.focus();
  return true;
}

export function registerTableCommands(app: GeodeApp, getView: () => EditorView | null) {
  return TABLE_COMMANDS.map((spec) =>
    app.commands.register({
      id: spec.id,
      name: () => t(spec.nameKey),
      available: () => getView() !== null,
      callback: () => {
        const view = getView();
        if (view) runTableOp(view, spec.op);
      },
    }),
  );
}
