/**
 * R215 — G3 §4: file-explorer:new-file-in-new-pane (⌘⇧N "Create new note in new pane").
 * Creates a unique empty note and opens it in a NEW split pane (split-right), reusing
 * app:new-note's create path + splitActivePane("row"). splitActivePane returns null for a
 * fileless-singleton active tab (graph etc.) → falls back to opening in a new tab.
 * Browser :1420.  Run: node .calibration/r215-e2e.mjs
 * Contract: ARCHITECTURE "Round 215 additions".
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r215", name: "r215", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const paneCount = () => app(() => {
  let n = 0;
  const walk = (node) => { if (node.tabs) n++; (node.children || []).forEach(walk); };
  walk(window.__app.workspace.state.get().root);
  return n;
});
const activeFile = () => app(() => { const t = window.__app.workspace.getActiveTab(); return t ? { vt: t.viewType, path: t.filePath } : null; });

console.log("A. command registration (⌘⇧N)");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "file-explorer:new-file-in-new-pane");
  return { present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey("file-explorer:new-file-in-new-pane") || null };
});
ok("file-explorer:new-file-in-new-pane registered", reg.present, JSON.stringify(reg));
ok("name resolves via i18n", reg.name === "Create new note in new pane", JSON.stringify(reg));
ok("default hotkey is Mod+Shift+N", reg.hotkey === "Mod+Shift+N", JSON.stringify(reg));

await app(async () => { try { await window.__app.vault.create("Base.md", "base content\n"); } catch { /* exists */ } });
await wait(200);
await app(() => window.__app.workspace.openFile("Base.md"));
await wait(150);

console.log("B. from a markdown tab → creates the note in a NEW split pane");
const panes0 = await paneCount();
await app(() => window.__app.commands.execute("file-explorer:new-file-in-new-pane"));
await wait(300);
const panes1 = await paneCount();
const af = await activeFile();
ok("a new pane was created (split)", panes1 === panes0 + 1, `${panes0}→${panes1}`);
ok("active tab is a new markdown note (Untitled*)", af && af.vt === "markdown" && /Untitled/.test(af.path || ""), JSON.stringify(af));
ok("the new note file exists + is empty",
  await app(([p]) => window.__app.vault.read(p).then((c) => c === "").catch(() => false), [af?.path]));
ok("Base.md is preserved (still open in the other pane)",
  await app(() => {
    const flat = []; const walk = (n) => { if (n.tabs) flat.push(...n.tabs); (n.children || []).forEach(walk); };
    walk(window.__app.workspace.state.get().root);
    return flat.some((t) => t.filePath === "Base.md");
  }));

console.log("C. edge: a fileless-singleton active tab (graph) → split null → falls back to a new tab");
await app(() => window.__app.workspace.openGraph());
await wait(150);
const panesG = await paneCount();
await app(() => window.__app.commands.execute("file-explorer:new-file-in-new-pane"));
await wait(300);
const panesG2 = await paneCount();
const afG = await activeFile();
ok("no new pane created when active tab is a singleton (split returned null)", panesG2 === panesG, `${panesG}→${panesG2}`);
ok("the new note still opened (as a new tab) — command not lost", afG && afG.vt === "markdown" && /Untitled/.test(afG.path || ""), JSON.stringify(afG));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR215: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
