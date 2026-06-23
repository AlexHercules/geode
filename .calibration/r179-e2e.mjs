/**
 * R179 — G4-a: Explorer "Copy path" / "Copy Obsidian URL" menu items — :1420.
 * Run: node .calibration/r179-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 179 additions" (G4-a).
 *
 * Obsidian exposes 复制库内路径 / 复制 Obsidian 链接 as file right-click items.
 * Geode adds them to the Explorer file context menu, reusing R46 buildOpenUri
 * (.md stripped, round-trips) + R77 clipboard pattern + the existing toast.
 * Pure read + clipboard write — no vault write path.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r179", name: "r179", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
// capture clipboard writes (headless has no real clipboard) — R77 pattern
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

// seed a file inside a folder (so the path/URL encoding covers a "/" separator)
await mkfolder("r179-dir");
await create("r179-dir/r179-note.md", "# r179 note\n");
await wait(300);

const FILE = "r179-dir/r179-note.md";

// expand the folder so the nested file row is rendered (r140 pattern)
await page.click(rowSel("r179-dir"));
await wait(150);

console.log("— file context menu exposes the two copy items —");
ok("right-click a file opens the menu", (await rightClick(rowSel(FILE))) && (await has("explorer-menu")));
ok("file menu has Copy path", await has("explorerctx-copy-path"));
ok("file menu has Copy Obsidian URL", await has("explorerctx-copy-obsidian-url"));

console.log("— Copy path → vault-relative path (incl. .md) on clipboard + toast —");
await page.click('[data-testid="explorerctx-copy-path"]');
await wait(120);
ok("clipboard got the vault-relative path", (await lastClip()) === FILE, JSON.stringify(await lastClip()));
ok("a copied toast appeared", await has("link-update-notice"));

console.log("— Copy Obsidian URL → obsidian://open?vault&file (.md stripped) —");
await rightClick(rowSel(FILE));
await wait(60);
await page.click('[data-testid="explorerctx-copy-obsidian-url"]');
await wait(120);
const urlCheck = await app(() => {
  const url = window.__clip[window.__clip.length - 1];
  let u;
  try { u = new URL(url); } catch { return { ok: false, why: "not a URL", url }; }
  const vault = u.searchParams.get("vault");
  const file = u.searchParams.get("file");
  return {
    ok: u.protocol === "obsidian:" && u.host === "open"
      && vault === window.__app.vault.vaultName
      && file === "r179-dir/r179-note", // .md stripped, "/" decoded by URL
    url, vault, file, expectVault: window.__app.vault.vaultName,
  };
});
ok("obsidian://open URL with correct vault + .md-stripped file", urlCheck.ok, JSON.stringify(urlCheck));
ok("URL encodes the path separator as %2F", await app(() =>
  window.__clip[window.__clip.length - 1].includes("file=r179-dir%2Fr179-note")));

console.log("— faithful scope: file-only (folder menu has neither) —");
await closeMenu();
await wait(60);
await rightClick(rowSel("r179-dir"));
await wait(60);
ok("folder menu does NOT have Copy path (file-only v1)", !(await has("explorerctx-copy-path")));
ok("folder menu does NOT have Copy Obsidian URL (file-only v1)", !(await has("explorerctx-copy-obsidian-url")));
await closeMenu();

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR179: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
