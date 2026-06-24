/**
 * R188 — G3 partial→done: editor:fold / editor:unfold split (Obsidian editor:fold /
 * editor:unfold, separate from editor:toggle-fold) — browser :1420.
 * Run: node .calibration/r188-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 188 additions".
 *
 * Drives the live CM view: cursor on a foldable heading → editor:fold renders a
 * .cm-foldPlaceholder; editor:unfold removes it. Folding is view-only — the doc bytes
 * are unchanged (data-safety: no .md write path, reuses CM foldCode/unfoldCode).
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r188", name: "r188", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = (id) => app(([cid]) => window.__app.commands.execute(cid), [id]);

const IDS = ["editor:fold", "editor:unfold"];

console.log("— both commands registered + names resolve —");
const reg = await app(([ids]) => ids.map((id) => {
  const c = window.__app.commands.list().find((x) => x.id === id);
  return { id, present: !!c, name: c ? c.name() : null };
}), [IDS]);
for (const r of reg) {
  ok(`${r.id} registered`, r.present);
  ok(`${r.id} name resolves (not raw key)`, !!r.name && !r.name.startsWith("cmd."), r.name);
}

console.log("— fold/unfold carry NO default hotkey (Obsidian parity; CM keymap owns Cmd-Alt-[/]) —");
for (const id of IDS) {
  ok(`${id} has no default hotkey`, !(await app(([cid]) => window.__app.commands.getEffectiveHotkey(cid), [id])));
}

console.log("— fold renders a placeholder; unfold removes it; doc bytes unchanged —");
const CONTENT = "# Head\nbody line one\nbody line two\n";
await app(async (c) => { try { await window.__app.vault.create("r188fold.md", c); } catch { /* exists */ } }, CONTENT);
await app(() => {
  window.__app.workspace.openFile("r188fold.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(250); // let the parse settle so the heading line is foldable
// put the cursor on the foldable heading line (line 1)
await app(() => {
  const v = window.__app.documents.getActiveView().view;
  v.dispatch({ selection: { anchor: 2 } });
});
await wait(80);

const docBefore = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
const hasPlaceholder = () => app(() => !!window.__app.documents.getActiveView().view.dom.querySelector(".cm-foldPlaceholder"));

ok("no placeholder before fold", !(await hasPlaceholder()));
await exec("editor:fold");
await wait(120);
ok("editor:fold renders .cm-foldPlaceholder", await hasPlaceholder());
ok("doc bytes unchanged after fold (view-only, no .md write)", (await app(() => window.__app.documents.getActiveView().view.state.doc.toString())) === docBefore);

await exec("editor:unfold");
await wait(120);
ok("editor:unfold removes the placeholder", !(await hasPlaceholder()));
ok("doc bytes still unchanged after unfold", (await app(() => window.__app.documents.getActiveView().view.state.doc.toString())) === docBefore);

console.log("— fold/unfold round-trip equals toggle-fold's effect —");
await exec("editor:fold");
await wait(100);
const foldedByFold = await hasPlaceholder();
await exec("editor:unfold");
await wait(100);
await exec("editor:toggle-fold"); // toggle from unfolded → folds
await wait(100);
ok("toggle-fold folds where editor:fold did", foldedByFold && (await hasPlaceholder()));
await exec("editor:toggle-fold"); // restore (unfold)
await wait(80);

console.log("— no active editor view: command is a safe no-op —");
await app(() => window.__app.workspace.openGraph());
await wait(150);
await exec("editor:fold"); // active view is graph → getActiveView() null → guarded
await wait(60);
ok("editor:fold on graph tab does not throw", true);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR188: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
