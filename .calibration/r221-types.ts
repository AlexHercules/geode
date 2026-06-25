/**
 * R221 (F2) COMPILE-TIME check: the new hover/MarkdownFileInfo type chain is importable
 * from the `obsidian` shim, and `Command.editorCallback`/`editorCheckCallback` ctx now
 * matches the d.ts (`MarkdownView | MarkdownFileInfo`) so a plugin can annotate the ctx
 * as MarkdownFileInfo and compile — exactly as it does against the real obsidian d.ts
 * (where `MarkdownView implements MarkdownFileInfo`). Pure type assertions, no runtime.
 * Each `@ts-expect-error` asserts a constraint actually bites (an unused directive fails
 * the compile, so green here means the type face is real, not loosened to `any`).
 *   Run: npx tsc -p .calibration/tsconfig.r221.json   (0 errors = pass)
 * Contract: ARCHITECTURE "Round 221 additions".
 */
import type {
  Command,
  MarkdownFileInfo,
  MarkdownView,
  HoverParent,
  Point,
} from "../src/compat/obsidian/index";
// value imports (HoverPopover is a class, PopoverState an enum — must be runtime values):
import { HoverPopover, PopoverState } from "../src/compat/obsidian/index";

// --- MarkdownFileInfo shape (d.ts:3954) ---
declare const mfi: MarkdownFileInfo;
const _file = mfi.file; // get file(): TFile | null
const _ed = mfi.editor; // editor?: Editor
const _app = mfi.app; // app: App
const _hp: HoverPopover | null = mfi.hoverPopover; // inherited from HoverParent
void _file;
void _ed;
void _app;
void _hp;

// --- HoverParent requires hoverPopover (d.ts:3464) ---
const hpOk: HoverParent = { hoverPopover: null };
// @ts-expect-error R221: HoverParent.hoverPopover is required
const hpBad: HoverParent = {};
void hpOk;
void hpBad;

// --- Point shape (d.ts:5179) ---
const pt: Point = { x: 1, y: 2 };
// @ts-expect-error R221: Point requires y
const ptBad: Point = { x: 1 };
void pt;
void ptBad;

// --- PopoverState is a real (empty) enum value; HoverPopover a constructible class (d.ts:5193/3476) ---
const ps: PopoverState = 0 as PopoverState;
const pop = new HoverPopover({ hoverPopover: null }, document.createElement("div"));
const pop2 = new HoverPopover({ hoverPopover: null }, null, 200, { x: 0, y: 0 });
const _popEl: HTMLElement = pop.hoverEl;
void ps;
void pop2;
void _popEl;

// --- Command.editorCallback ctx = MarkdownView | MarkdownFileInfo (d.ts:1794/1821) ---
// A plugin annotating the modern MarkdownFileInfo ctx now compiles (R221 widen + MarkdownView
// implements MarkdownFileInfo). This is the core compile-consistency win.
const cmd: Command = {
  id: "r221",
  name: "R221",
  editorCallback: (_editor, ctx: MarkdownFileInfo) => {
    void ctx.file;
    void ctx.editor;
  },
};
const cmd2: Command = {
  id: "r221b",
  name: "R221b",
  editorCheckCallback: (_checking, _editor, ctx: MarkdownFileInfo) => {
    void ctx;
    return true;
  },
};
// Inferred ctx is the union — common-case plugins read the shared members:
const cmd3: Command = {
  id: "r221c",
  name: "R221c",
  editorCallback: (_editor, ctx) => {
    const _f = ctx.file; // present on both union members
    void _f;
  },
};
void cmd;
void cmd2;
void cmd3;

// @ts-expect-error R221: ctx is a real union (MarkdownView | MarkdownFileInfo), NOT `any` — an unrelated type must fail
const cmdBad: Command = { id: "x", name: "x", editorCallback: (_e, _ctx: number) => {} };
void cmdBad;

// A pure MarkdownView annotation is NOT accepted (union is wider than MarkdownView) — same as the
// real obsidian d.ts, where annotating the narrower MarkdownView also fails. Consistency proof.
// @ts-expect-error R221: editorCallback ctx is MarkdownView | MarkdownFileInfo, narrowing to MarkdownView fails
const cmdNarrow: Command = { id: "y", name: "y", editorCallback: (_e, _ctx: MarkdownView) => {} };
void cmdNarrow;
