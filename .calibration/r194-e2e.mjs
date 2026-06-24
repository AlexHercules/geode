/**
 * R194 — G3 missing→done: editor:clear-metadata-properties (Obsidian "Clear note
 * properties") — browser :1420. Run: node .calibration/r194-e2e.mjs   (dev server up)
 * Contract: docs/ARCHITECTURE.md "Round 194 additions".
 *
 * Removes the whole frontmatter block (reusing the R22-vetted properties bounds). Drives
 * the live CM view and asserts exact doc bytes: the block is gone, the body is preserved,
 * and no-frontmatter / content-before-frontmatter / no-properties are safe no-ops.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r194", name: "r194", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("— command registered + name resolves + no default hotkey —");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "editor:clear-metadata-properties");
  return { present: !!c, name: c ? c.name() : null, hk: window.__app.commands.getEffectiveHotkey("editor:clear-metadata-properties") || null };
});
ok("editor:clear-metadata-properties registered", reg.present);
ok("name resolves (not raw key)", !!reg.name && !reg.name.startsWith("cmd."), reg.name);
ok("has no default hotkey (Obsidian parity)", reg.hk === null, reg.hk);

// open an editor in live mode
await app(async () => { try { await window.__app.vault.create("r194props.md", "x\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r194props.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);

// set whole-doc content, run clear-metadata-properties, return resulting doc
async function clearOn(content) {
  await app(([c]) => {
    const v = window.__app.documents.getActiveView().view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c }, selection: { anchor: 0 } });
  }, [content]);
  await wait(120);
  await app(() => window.__app.commands.execute("editor:clear-metadata-properties"));
  await wait(80);
  return app(() => window.__app.documents.getActiveView().view.state.doc.toString());
}

console.log("— removes the frontmatter block, preserves the body (exact bytes) —");
ok("single property → body only", (await clearOn("---\nk: v\n---\nbody text\n")) === "body text\n", await clearOn("---\nk: v\n---\nbody text\n"));
ok("multiple properties → body only", (await clearOn("---\na: 1\nb: two\ntags:\n  - x\n---\n# Title\npara\n")) === "# Title\npara\n", await clearOn("---\na: 1\nb: two\ntags:\n  - x\n---\n# Title\npara\n"));
ok("frontmatter-only note → empty", (await clearOn("---\nk: v\n---\n")) === "", await clearOn("---\nk: v\n---\n"));

console.log("— BYTE SAFETY: body content (wikilinks / emphasis / special) preserved verbatim —");
ok("body with [[link]] **bold** $math$ preserved", (await clearOn("---\nk: v\n---\nsee [[A]] and **b** and $x*y$\n")) === "see [[A]] and **b** and $x*y$\n", await clearOn("---\nk: v\n---\nsee [[A]] and **b** and $x*y$\n"));

console.log("— no-op cases (no frontmatter / not at offset 0) —");
ok("no frontmatter → unchanged", (await clearOn("# Title\nbody\n")) === "# Title\nbody\n");
ok("content before --- → unchanged (frontmatter must be at offset 0)", (await clearOn("intro\n---\nk: v\n---\n")) === "intro\n---\nk: v\n---\n", await clearOn("intro\n---\nk: v\n---\n"));
ok("plain text → unchanged", (await clearOn("just text no fence\n")) === "just text no fence\n");

console.log("— undoable: the clear is a normal CM transaction (Ctrl-Z restores) —");
await clearOn("---\nk: v\n---\nbody\n");
await app(() => {
  const v = window.__app.documents.getActiveView().view;
  // CM history: dispatch an undo
  v.dispatch({ effects: [] });
});
// use the editor undo command path
await app(() => window.__app.documents.getActiveView().view.dom.focus());
await page.keyboard.press("Meta+z");
await wait(100);
ok("undo restores the frontmatter block", (await app(() => window.__app.documents.getActiveView().view.state.doc.toString())).startsWith("---\nk: v\n---"), await app(() => window.__app.documents.getActiveView().view.state.doc.toString()));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR194: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
