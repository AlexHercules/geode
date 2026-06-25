/**
 * R221 (F2) RUNTIME check — the type-aligned hover/MarkdownFileInfo chain works at
 * runtime, and `Command.editorCallback` (ctx widened to MarkdownView | MarkdownFileInfo)
 * still dispatches. A seeded obsidian plugin require()s the shim so we exercise the real
 * value exports (the pure type surface is proven by r221-types.ts + tsconfig.r221.json):
 *   A. require('obsidian').HoverPopover (class) + PopoverState (enum) are real values.
 *   B. new HoverPopover(...) is an inert shim — constructs, hoverEl is a DIV, extends Component.
 *   C. compat addCommand({ editorCallback }) registers (ctx widen didn't break it).
 *   D. executing it runs the editorCallback; ctx is a MarkdownView that satisfies
 *      MarkdownFileInfo (has hoverPopover + editor + app) and the edit writes through.
 * Browser :1420.  Run: node .calibration/r221-e2e.mjs
 * Contract: ARCHITECTURE "Round 221 additions".
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

// seed an obsidian community plugin that require()s the shim and exercises R221's
// value exports at module-eval time, then registers an editorCallback command.
await page.addInitScript(() => {
  const mainJs = [
    "const obs = require('obsidian');",
    "window.__r221 = window.__r221 || {};",
    "window.__r221.hasHoverPopover = typeof obs.HoverPopover === 'function';",
    "window.__r221.hasPopoverState = (typeof obs.PopoverState !== 'undefined');",
    "try {",
    "  const hp = new obs.HoverPopover({ hoverPopover: null }, document.createElement('div'), 100, { x: 0, y: 0 });",
    "  window.__r221.hpElTag = hp.hoverEl && hp.hoverEl.tagName;",
    "  window.__r221.hpIsComponent = hp instanceof obs.Component;",
    "} catch (e) { window.__r221.hpThrew = String(e); }",
    "module.exports = class extends obs.Plugin {",
    "  onload() {",
    "    this.addCommand({",
    "      id: 'r221-ed', name: 'R221 editor cmd',",
    "      editorCallback: function(editor, ctx) {",
    "        window.__r221.ran = true;",
    "        window.__r221.ctxIsMDView = ctx instanceof obs.MarkdownView;",
    "        window.__r221.ctxHasHoverField = ('hoverPopover' in ctx);",
    "        window.__r221.ctxHasEditor = !!ctx.editor;",
    "        window.__r221.ctxHasApp = !!ctx.app;",
    "        editor.replaceSelection('R221OK');",
    "      }",
    "    });",
    "    window.__r221.onloadRan = true;",
    "  }",
    "  onunload() {}",
    "};",
  ].join("\n");
  window.__geodeObsidianPlugins = [
    { dir: "r221-test", manifestJson: JSON.stringify({ id: "r221-test", name: "R221 Test", version: "1.0.0", minAppVersion: "0.0.1" }), mainJs, stylesCss: null, dataJson: null },
  ];
  window.__geodeObsidianConfig = { "community-plugins.json": '["r221-test"]' };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
});

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.waitForFunction(() => window.__r221 && window.__r221.onloadRan, null, { timeout: 8000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("A. require('obsidian') value exports — HoverPopover (class) + PopoverState (enum)");
const sym = await ev(() => window.__r221);
ok("require('obsidian').HoverPopover is a constructor", sym.hasHoverPopover === true, JSON.stringify(sym));
ok("require('obsidian').PopoverState is defined (enum value)", sym.hasPopoverState === true, JSON.stringify(sym));

console.log("B. new HoverPopover(...) — inert shim: constructs, hoverEl is DIV, extends Component");
ok("HoverPopover constructed (no throw)", !sym.hpThrew, sym.hpThrew || "");
ok("HoverPopover.hoverEl is a DIV", sym.hpElTag === "DIV", JSON.stringify(sym.hpElTag));
ok("HoverPopover instanceof Component", sym.hpIsComponent === true);

console.log("C. compat addCommand({ editorCallback }) registered (ctx widen intact)");
const reg = await ev(() => {
  const c = window.geode.app.commands.list().find((x) => x.id === "r221-test:r221-ed");
  const name = c ? (typeof c.name === "function" ? c.name() : c.name) : null;
  return { present: !!c, name };
});
ok("r221-test:r221-ed registered", reg.present, JSON.stringify(reg));
ok("name prefixed with plugin name", reg.name === "R221 Test: R221 editor cmd", JSON.stringify(reg));

console.log("D. executing it runs editorCallback; ctx satisfies MarkdownFileInfo + edit writes through");
await ev(async () => {
  try { await window.geode.app.vault.create("r221.md", "alpha bravo\n"); } catch { /* exists */ }
  window.geode.app.workspace.openFile("r221.md");
});
await ev(() => { const t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "live"); });
await page.waitForSelector(".cm-content", { timeout: 5000 });
await page.click(".cm-content");
await wait(120);
await ev(() => window.geode.app.commands.execute("r221-test:r221-ed"));
await wait(150);
const ran = await ev(() => window.__r221);
ok("editorCallback ran", ran.ran === true, JSON.stringify(ran));
ok("ctx instanceof MarkdownView", ran.ctxIsMDView === true, JSON.stringify(ran.ctxIsMDView));
ok("ctx has hoverPopover field (MarkdownFileInfo conformance)", ran.ctxHasHoverField === true);
ok("ctx has editor (MarkdownFileInfo)", ran.ctxHasEditor === true);
ok("ctx has app (MarkdownFileInfo)", ran.ctxHasApp === true);
const doc = await ev(() => window.app.workspace.activeEditor && window.app.workspace.activeEditor.editor.getValue());
ok("editorCallback wrote through (replaceSelection)", typeof doc === "string" && doc.includes("R221OK"), JSON.stringify(doc));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR221: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
