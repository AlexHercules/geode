/**
 * R210 — G3 §10 missing→done: editor:toggle-fold-properties (折叠/展开当前笔记属性).
 * Folds the properties panel; pure VIEW state (per-path), never mutates the doc.
 * Browser :1420.  Run: node .calibration/r210-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 210 additions".
 *
 * A = registration (no default hotkey).
 * B = command folds/unfolds (is-collapsed class + rows hidden) AND the doc text is
 *     byte-identical before/after (pure view — data-safety: never writes .md).
 * C = the chevron button toggles too.
 * D = per-note state (folding note A doesn't fold note B; A stays folded on return).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r210", name: "r210", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FM = "---\ntitle: Hello\ntags: a\n---\nbody\n";

async function openLive(path, body) {
  await app(async ([p, c]) => { try { await window.__app.vault.create(p, c); } catch { /* exists */ } }, [path, body]);
  await app((p) => {
    window.__app.workspace.openFile(p);
    const tab = window.__app.workspace.getActiveTab();
    window.__app.workspace.setTabMode(tab.id, "live");
  }, path);
  await page.waitForFunction(() => !!document.querySelector('[data-testid="properties-panel"]'), null, { timeout: 5000 });
  await wait(120);
}
const panelCollapsed = () => app(() => document.querySelector('[data-testid="properties-panel"]')?.classList.contains("is-collapsed") ?? null);
const rowDisplay = () => app(() => {
  const row = document.querySelector('[data-testid="properties-panel"] .property-row');
  return row ? getComputedStyle(row).display : "no-row";
});
const docText = () => app(() => window.__app.documents.getActiveView().view.state.doc.toString());

console.log("A. command registration + no default hotkey");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "editor:toggle-fold-properties");
  return { present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey("editor:toggle-fold-properties") || null };
});
ok("editor:toggle-fold-properties registered", reg.present);
ok("name resolves (not raw 'cmd.' key)", !!reg.name && !reg.name.startsWith("cmd."), String(reg.name));
ok("has NO default hotkey", reg.hotkey === null, String(reg.hotkey));

console.log("B. command folds/unfolds; the document is NEVER mutated (pure view)");
await openLive("noteA.md", FM);
ok("properties panel starts expanded", (await panelCollapsed()) === false);
ok("property rows visible initially", (await rowDisplay()) !== "none");
const before = await docText();
await app(() => window.__app.commands.execute("editor:toggle-fold-properties"));
await wait(120);
ok("after command → panel is-collapsed", (await panelCollapsed()) === true);
ok("after command → property rows hidden (display:none)", (await rowDisplay()) === "none");
ok("底线①: document text byte-identical after fold (no .md write)", (await docText()) === before, "doc changed!");
await app(() => window.__app.commands.execute("editor:toggle-fold-properties"));
await wait(120);
ok("command again → expanded", (await panelCollapsed()) === false);
ok("document still byte-identical after unfold", (await docText()) === before);

console.log("C. the chevron button toggles too");
await app(() => document.querySelector('[data-testid="properties-fold-toggle"]')?.click());
await wait(120);
ok("chevron click → collapsed", (await panelCollapsed()) === true);
ok("chevron has aria-expanded=false when collapsed", (await app(() => document.querySelector('[data-testid="properties-fold-toggle"]')?.getAttribute("aria-expanded"))) === "false");
await app(() => document.querySelector('[data-testid="properties-fold-toggle"]')?.click());
await wait(120);
ok("chevron click again → expanded", (await panelCollapsed()) === false);

console.log("D. per-note fold state (folding A doesn't fold B; A stays folded on return)");
await app(() => window.__app.commands.execute("editor:toggle-fold-properties")); // fold A
await wait(120);
ok("noteA folded", (await panelCollapsed()) === true);
await openLive("noteB.md", FM);
ok("noteB (different file) is NOT folded", (await panelCollapsed()) === false);
await app(() => { window.__app.workspace.openFile("noteA.md"); });
await page.waitForFunction(() => !!document.querySelector('[data-testid="properties-panel"]'), null, { timeout: 5000 });
await wait(150);
ok("returning to noteA → still folded (per-path state persisted)", (await panelCollapsed()) === true);

console.log("E. command gated on the note having a properties block (review fix #1)");
const availForId = () => app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "editor:toggle-fold-properties");
  return c && typeof c.available === "function" ? c.available() : "no-available-fn";
});
ok("note WITH properties → command available", (await availForId()) === true);
// open a note with NO frontmatter (no properties panel) — toggling here would store
// phantom fold state that hides a later-added property; the fix gates it off
await app(async () => { try { await window.__app.vault.create("plain.md", "just text, no frontmatter\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("plain.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!document.querySelector('[data-testid="cm-editor"]'), null, { timeout: 5000 });
await wait(150);
ok("note WITHOUT properties → command NOT available (no phantom fold state)", (await availForId()) === false);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR210: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
