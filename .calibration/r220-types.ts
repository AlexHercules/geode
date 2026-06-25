/**
 * R220 (F2) COMPILE-TIME check: a plugin's d.ts-shaped usage of the aligned compat
 * Editor type surface must compile against Geode's `obsidian` shim, and the 5 newly
 * re-exported metadata cache interfaces must be importable. Pure type assertions — no
 * runtime. The `@ts-expect-error` lines assert the tightened constraints actually bite
 * (an unused @ts-expect-error fails the compile).
 *   Run: npx tsc -p .calibration/tsconfig.r220.json   (0 errors = pass)
 * Contract: ARCHITECTURE "Round 220 additions".
 */
import type {
  Editor,
  EditorRange,
  EditorRangeOrCaret,
  EditorChange,
  EditorTransaction,
  EditorPosition,
  // R220: metadata barrel re-exports (Dataview etc. import these):
  SectionCache,
  ListItemCache,
  FootnoteCache,
  FootnoteRefCache,
  FrontmatterLinkCache,
} from "../src/compat/obsidian/index";

const pos: EditorPosition = { line: 0, ch: 0 };

// EditorRange.to is REQUIRED (d.ts parity)
const range: EditorRange = { from: pos, to: pos };
// @ts-expect-error R220: EditorRange.to is required — omitting it must fail to compile
const badRange: EditorRange = { from: pos };

// EditorRangeOrCaret.to is optional
const caret: EditorRangeOrCaret = { from: pos };
const ror: EditorRangeOrCaret = { from: pos, to: pos };

// EditorChange extends EditorRangeOrCaret { text } — `to` optional
const change: EditorChange = { from: pos, text: "x" };
const change2: EditorChange = { from: pos, to: pos, text: "y" };

// EditorTransaction: selection is EditorRangeOrCaret, selections? present
const txn: EditorTransaction = {
  changes: [change],
  selection: caret,
  selections: [caret, ror],
  replaceSelection: "z",
};

// Editor methods accept the d.ts-shaped extra args
declare const ed: Editor;
ed.replaceSelection("text", "my-origin"); // origin? param (R220)
ed.setSelections([{ anchor: pos }], 0); // main? param (R220)
const self: Editor = ed.getDoc(); // getDoc(): this (R220)
const w: EditorRange | null = ed.wordAt(pos);

// metadata cache interfaces are importable (re-export smoke; shapes via fields)
declare const sc: SectionCache;
declare const lic: ListItemCache;
declare const fc: FootnoteCache;
declare const frc: FootnoteRefCache;
declare const flc: FrontmatterLinkCache;
const _scId: string | undefined = sc.id;
const _licTask: string | undefined = lic.task;

// touch everything so noUnusedLocals (off here, but be tidy) / readers see intent
void range; void badRange; void caret; void ror; void change; void change2;
void txn; void self; void w; void fc; void frc; void flc; void _scId; void _licTask;
