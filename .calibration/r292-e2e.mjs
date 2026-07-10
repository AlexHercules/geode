/**
 * R292 - G4-b: Explorer folder right-click menu parity. Copy path / Reveal in
 * system / Open in default app were file-only; R292 adds them to folders.
 * Run: node .calibration/r292-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 292 additions".
 *
 * reference/08-右键菜单.md: the file-tree context menu base items (copy path /
 * default app / reveal / move / rename / delete) apply to files AND folders;
 * folders additionally get new-note-here / new-folder-here / set-attachment-folder.
 * File-only items (open-new-tab / open-right / make-copy / copy-obsidian-url) stay
 * file-only (folders have no tab / no obsidian:// URL; makeCopy is file-guarded).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r292", name: "r292", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
// capture clipboard writes (headless has no real clipboard) - R77 pattern
await page.evaluate(() => {
  window.__clip = [];
  navigator.clipboard.writeText = (t) => { window.__clip.push(t); return Promise.resolve(); };
});

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
const lastClip = () => app(() => window.__clip[window.__clip.length - 1] ?? null);
const rightClick = (sel, x = 40, y = 40) => app(([s, cx, cy]) => {
  const el = document.querySelector(s);
  if (!el) return false;
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: cx, clientY: cy }));
  return true;
}, [sel, x, y]);
const closeMenu = () => app(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
const rowSel = (p) => `[data-testid="explorer"] [data-testid="explorer-item"][data-path="${p}"]`;

// seed a folder + a root file (file-menu regression)
await mkfolder("r292-dir");
await create("r292-note.md", "# r292 note\n");
await wait(300);

const FOLDER = "r292-dir";
const FILE = "r292-note.md";

console.log("- folder context menu gains the previously file-only items (R292) -");
ok("right-click a folder opens the menu", (await rightClick(rowSel(FOLDER))) && (await has("explorer-menu")));
ok("folder menu HAS Copy path (R292 parity)", await has("explorerctx-copy-path"));
ok("folder menu HAS new-note-here (folder-only)", await has("explorerctx-new-note-here"));
ok("folder menu HAS new-folder-here (folder-only)", await has("explorerctx-new-folder-here"));
ok("folder menu HAS set-attachment-folder (folder-only)", await has("explorerctx-set-attachment-folder"));
ok("folder menu HAS move-to (shared)", await has("explorerctx-move-to"));
ok("folder menu HAS rename (shared)", await has("explorerctx-rename"));
ok("folder menu HAS delete (shared)", await has("explorerctx-delete"));

console.log("- folder menu keeps file-only items OUT (no tab / no obsidian:// URL) -");
ok("folder menu does NOT have Open in new tab (file-only)", !(await has("explorerctx-open-new-tab")));
ok("folder menu does NOT have Open to right (file-only)", !(await has("explorerctx-open-right")));
ok("folder menu does NOT have Make a copy (file-only)", !(await has("explorerctx-make-copy")));
ok("folder menu does NOT have Copy Obsidian URL (file-only)", !(await has("explorerctx-copy-obsidian-url")));

console.log("- folder menu: desktop-only OS items hidden in browser (isTauri gate) -");
ok("folder menu hides Reveal in system in browser", !(await has("explorerctx-reveal-in-system")));
ok("folder menu hides Open in default app in browser", !(await has("explorerctx-open-in-default-app")));

console.log("- folder Copy path -> vault-relative folder path (no extension, discriminating) -");
await page.click('[data-testid="explorerctx-copy-path"]');
await wait(120);
ok("folder Copy path puts the folder path on the clipboard", (await lastClip()) === FOLDER, JSON.stringify(await lastClip()));
await closeMenu();
await wait(60);

console.log("- file menu regression: file-only items still present, OS items still browser-hidden -");
ok("right-click a file opens the menu", (await rightClick(rowSel(FILE))) && (await has("explorer-menu")));
ok("file menu HAS Copy path", await has("explorerctx-copy-path"));
ok("file menu HAS Copy Obsidian URL", await has("explorerctx-copy-obsidian-url"));
ok("file menu HAS Open in new tab", await has("explorerctx-open-new-tab"));
ok("file menu HAS Open to right", await has("explorerctx-open-right"));
ok("file menu HAS Make a copy", await has("explorerctx-make-copy"));
ok("file menu hides Reveal in system in browser", !(await has("explorerctx-reveal-in-system")));
ok("file menu hides Open in default app in browser", !(await has("explorerctx-open-in-default-app")));
await page.click('[data-testid="explorerctx-copy-path"]');
await wait(120);
ok("file Copy path puts the file path (incl .md) on the clipboard", (await lastClip()) === FILE, JSON.stringify(await lastClip()));
await closeMenu();

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR292: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
