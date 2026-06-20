/**
 * R137 compat WorkspaceLeaf.setViewState programmatic mode switch E2E — browser mode :1420.
 * Run: node .calibration/r137-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 137 additions".
 *
 * Obsidian has no public MarkdownView.setMode; plugins switch a markdown view's mode via
 * leaf.setViewState({type:"markdown", state:{mode:"source"|"preview", source?}}). R137 makes Geode's
 * WorkspaceLeaf.setViewState honor a mode-only change (no file) on the open tab, mapping
 * preview→preview, source+source:false→live, source(else)→source — the same setTabMode path as Ctrl+E.
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
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r137", name: "r137", onload(app) { window.__app = app; } }));
// window.app is the compat App (loader.ts sets it); its workspace.activeLeaf is the WorkspaceLeaf
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace && !!window.app.workspace.activeLeaf, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = () => app(() => window.__app.workspace.getActiveTab()?.mode ?? null);
const setViewState = (state) => app(async (s) => { await window.app.workspace.activeLeaf.setViewState(s); }, state);

// open a note and put it in live mode as the baseline
const SRC = "r137.md";
await app(async ([p]) => {
  try { await window.__app.vault.create(p, "# R137\n\nbody\n"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
  window.__app.workspace.openFile(p);
  window.__app.workspace.setTabMode(window.__app.workspace.getActiveTab().id, "live");
  await new Promise((r) => setTimeout(r, 150));
}, [SRC]);
ok("baseline: the tab is in live mode", (await mode()) === "live", JSON.stringify(await mode()));

console.log("— setViewState({state:{mode}}) switches the open tab's mode (no file) —");
await setViewState({ type: "markdown", state: { mode: "preview" } });
await wait(120);
ok("mode:'preview' → reading view (tab.mode = preview)", (await mode()) === "preview", JSON.stringify(await mode()));

await setViewState({ type: "markdown", state: { mode: "source" } });
await wait(120);
ok("mode:'source' (no source flag) → raw source (tab.mode = source)", (await mode()) === "source", JSON.stringify(await mode()));

await setViewState({ type: "markdown", state: { mode: "source", source: false } });
await wait(120);
ok("mode:'source' + source:false → live preview (tab.mode = live)", (await mode()) === "live", JSON.stringify(await mode()));

await setViewState({ type: "markdown", state: { mode: "preview" } });
await wait(120);
ok("round-trips back to preview", (await mode()) === "preview", JSON.stringify(await mode()));

console.log("— the DOM reflects the switch (reading view ↔ editor) —");
ok("preview mode shows the reading view (.preview-content present)", await app(() => !!document.querySelector(".preview-content")));
await setViewState({ type: "markdown", state: { mode: "source" } });
await wait(150);
ok("source mode shows the editor (.cm-content present, no .preview-content)", await app(() => !!document.querySelector(".cm-content") && !document.querySelector(".preview-content")));

console.log("— an unknown / mode-less view type is a recorded no-op, not a crash —");
const before = await mode();
await setViewState({ type: "some-unknown-view" });
await wait(80);
ok("unknown view type does NOT change the mode (reportGap no-op)", (await mode()) === before, `${await mode()} vs ${before}`);
await setViewState({ type: "markdown", state: {} }); // markdown but no file/mode → no-op
await wait(80);
ok("markdown state with no file/mode is a no-op (mode unchanged)", (await mode()) === before, JSON.stringify(await mode()));

console.log("— file + mode in one setViewState opens the file AND applies the mode —");
await app(async ([p]) => { try { await window.__app.vault.create(p, "# Other\n\nx\n"); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, ["r137-other.md"]);
await setViewState({ type: "markdown", state: { file: "r137-other.md", mode: "preview" } });
await wait(150);
ok("file+mode: the named file is now active in preview mode", (await mode()) === "preview" && (await app(() => window.__app.workspace.getActiveTab()?.filePath)) === "r137-other.md", JSON.stringify({ m: await mode(), p: await app(() => window.__app.workspace.getActiveTab()?.filePath) }));

console.log("— review MINOR fix: a markdown mode-switch on a NON-markdown (graph) tab does not stamp mode —");
await app(() => window.__app.workspace.openGraph());
await wait(150);
const graphBefore = await app(() => { const t = window.__app.workspace.getActiveTab(); return t ? { viewType: t.viewType, mode: t.mode } : null; });
ok("a graph tab is now active", graphBefore && graphBefore.viewType === "graph", JSON.stringify(graphBefore));
await setViewState({ type: "markdown", state: { mode: "source" } });
await wait(120);
const graphAfter = await app(() => { const t = window.__app.workspace.getActiveTab(); return t ? { viewType: t.viewType, mode: t.mode } : null; });
ok("the graph tab's mode was NOT stamped by a markdown mode-switch (viewType guard)", graphAfter && graphAfter.viewType === "graph" && graphAfter.mode === graphBefore.mode, JSON.stringify({ before: graphBefore, after: graphAfter }));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR137 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
