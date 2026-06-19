/**
 * R93 Explorer right-click context menu E2E — browser mode :1420.
 * Run: node .calibration/r93-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 93 additions" (㊽ 续续 right-click menu).
 *
 * The Explorer already had a row menu (New note here / New folder here / Rename /
 * Delete). R93 ADDS file items (Open in new tab / Open to the right / Make a copy)
 * + an empty-area root menu (New note / New folder) + R81 two-axis clamp + per-item
 * testids. Writes go through vetted vault paths (createBinary copy / trash / rename).
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
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r93", name: "r93", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeExplorerCopy, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const mkfolder = (p) => app(async ([path]) => {
  try { await window.__app.vault.createFolder(path); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p]);
const has = (testid) => app(([id]) => !!document.querySelector(`[data-testid="${id}"]`), [testid]);
const fileExists = (p) => app(([path]) => window.__app.vault.fileExists(path), [p]);
const activeFilePath = () => app(() => window.__app.workspace.getActiveTab()?.filePath ?? null);
const paneCount = () => app(() => {
  const count = (node) => ("tabs" in node ? 1 : node.children.reduce((a, c) => a + count(c), 0));
  return count(window.__app.workspace.state.get().root);
});
// dispatch a real contextmenu on a specific element (row stopPropagation vs container)
const rightClick = (sel, x = 40, y = 40) => app(([s, cx, cy]) => {
  const el = document.querySelector(s);
  if (!el) return false;
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: cx, clientY: cy }));
  return true;
}, [sel, x, y]);
const closeMenu = () => app(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
const rowSel = (p) => `[data-testid="explorer"] [data-testid="explorer-item"][data-path="${p}"]`;

// seed a file + a folder
await create("r93-note.md", "# r93 note\n\nhello body\n");
await mkfolder("r93-dir");
await wait(300);

// ── file row menu: new items present ────────────────────────────────────────
console.log("— file context menu —");
ok("right-click a file opens the menu", (await rightClick(rowSel("r93-note.md"))) && (await has("explorer-menu")));
ok("file menu has Open in new tab", await has("explorerctx-open-new-tab"));
ok("file menu has Open to the right", await has("explorerctx-open-right"));
ok("file menu has Make a copy", await has("explorerctx-make-copy"));
ok("file menu has Rename + Delete", (await has("explorerctx-rename")) && (await has("explorerctx-delete")));
ok("file menu does NOT have folder-only New note here", !(await has("explorerctx-new-note-here")));
await closeMenu();
await wait(80);
ok("Escape closes the menu", !(await has("explorer-menu")));

// ── Make a copy ─────────────────────────────────────────────────────────────
console.log("— make a copy —");
await rightClick(rowSel("r93-note.md"));
await wait(60);
await page.click('[data-testid="explorerctx-make-copy"]');
await wait(200);
ok("make a copy creates 'r93-note 1.md'", await fileExists("r93-note 1.md"));
ok("the copy has the same content as the source", await app(async () => {
  const a = await window.__app.vault.read("r93-note.md");
  const b = await window.__app.vault.read("r93-note 1.md");
  return a === b;
}));
ok("the source file is untouched after copy", await fileExists("r93-note.md"));
// R93 review (Finding 1): edit+save the copy as TEXT, then re-copy — the new copy
// must hold the EDITED content (readBinary must not return stale binary bytes after
// a writeFile; the Memory adapter now drops the binary twin on text write).
await app(() => window.__app.vault.modify("r93-note 1.md", "# edited copy\n"));
await wait(80);
const recopy = await app(() => window.__geodeExplorerCopy("r93-note 1.md"));
ok("re-copy of an edited copy holds the edited content (no stale readBinary)",
  (await app(([d]) => window.__app.vault.read(d), [recopy.dest])) === "# edited copy\n", JSON.stringify(recopy));
// R93 review (Finding 2): an extensionless file copies WITHOUT a trailing dot
await create("LICENSE", "MIT\n");
await wait(80);
const licCopy = await app(() => window.__geodeExplorerCopy("LICENSE"));
ok("extensionless copy has no trailing dot ('LICENSE 1')", licCopy.dest === "LICENSE 1", JSON.stringify(licCopy.dest));

// ── Open in new tab ─────────────────────────────────────────────────────────
console.log("— open in new tab —");
await rightClick(rowSel("r93-note.md"));
await wait(60);
await page.click('[data-testid="explorerctx-open-new-tab"]');
await wait(150);
ok("open in new tab makes the file the active tab", (await activeFilePath()) === "r93-note.md");

// ── Open to the right (splits a pane) ───────────────────────────────────────
console.log("— open to the right —");
const before = await paneCount();
await rightClick(rowSel("r93-note.md"));
await wait(60);
await page.click('[data-testid="explorerctx-open-right"]');
await wait(200);
ok("open to the right splits into a new pane", (await paneCount()) === before + 1, `before=${before} after=${await paneCount()}`);
ok("open to the right targets the file in the new pane", (await activeFilePath()) === "r93-note.md");

// ── folder row menu ─────────────────────────────────────────────────────────
console.log("— folder context menu —");
await rightClick(rowSel("r93-dir"));
await wait(60);
ok("folder menu has New note here + New folder here", (await has("explorerctx-new-note-here")) && (await has("explorerctx-new-folder-here")));
ok("folder menu has Rename + Delete", (await has("explorerctx-rename")) && (await has("explorerctx-delete")));
ok("folder menu does NOT have file-only Open in new tab / Make a copy", !(await has("explorerctx-open-new-tab")) && !(await has("explorerctx-make-copy")));
await closeMenu();
await wait(60);

// ── empty-area root menu ────────────────────────────────────────────────────
console.log("— empty-area root menu —");
ok("right-click empty tree area opens root menu", (await rightClick('[data-testid="explorer"] .explorer-tree', 30, 320)) && (await has("explorer-menu")));
ok("root menu has New note + New folder", (await has("explorerctx-new-note")) && (await has("explorerctx-new-folder")));
ok("root menu does NOT have Rename / Delete (no node)", !(await has("explorerctx-rename")) && !(await has("explorerctx-delete")));
await page.click('[data-testid="explorerctx-new-folder"]');
await wait(200);
ok("root New folder creates a folder at vault root", await app(() => window.__app.vault.folderExists("New folder")));

console.log(`\nR93 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
