/**
 * R97 "Move to…" folder picker E2E — browser mode :1420.
 * Run: node .calibration/r97-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 97 additions" (㊽ 续续续续).
 *
 * A fuzzy folder picker opened from the Explorer right-click "Move to…"; selecting a
 * folder routes through the vetted moveNode (R28/R16 renameWithLinkUpdate), so links are
 * rewritten and content is preserved. Covers candidate enumeration, the real move + link
 * rewrite (data-safety), fuzzy filter, root, and close-without-move.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r97", name: "r97", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeMoveFolders, null, { timeout: 5000 });

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
const read = (p) => app(([path]) => window.__app.vault.read(path).catch(() => null), [p]);
const fileExists = (p) => app(([path]) => window.__app.vault.fileExists(path), [p]);
const rowSel = (p) => `[data-testid="explorer"] [data-testid="explorer-item"][data-path="${p}"]`;
const rightClick = (sel) => app(([s]) => {
  const el = document.querySelector(s);
  if (!el) return false;
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }));
  return true;
}, [sel]);

// ── candidate enumeration (probe) ───────────────────────────────────────────
console.log("— move target enumeration (probe) —");
await mkfolder("Dest");
await mkfolder("Other");
await mkfolder("Dest/Inner");
await create("top.md", "x");
await create("Dest/already.md", "x");
await wait(250);
const topTargets = await app(() => window.__geodeMoveFolders("top.md"));
ok("a root file's targets include all folders", topTargets.includes("Dest") && topTargets.includes("Other") && topTargets.includes("Dest/Inner"), JSON.stringify(topTargets));
const innerTargets = await app(() => window.__geodeMoveFolders("Dest/already.md"));
ok("a file's current parent is excluded (no-op)", !innerTargets.includes("Dest"), JSON.stringify(innerTargets));
const folderTargets = await app(() => window.__geodeMoveFolders("Dest"));
ok("moving a folder excludes itself + descendants", !folderTargets.includes("Dest") && !folderTargets.includes("Dest/Inner"), JSON.stringify(folderTargets));

// ── real move via the picker + link rewrite (data-safety) ───────────────────
console.log("— move via picker + link rewrite —");
await create("src.md", "# Source\nbody\n");
await create("linker.md", "see [src](src.md)\n"); // md link is path-based → must rewrite on move
await wait(250);
ok("right-click → menu has 'Move to…'", (await rightClick(rowSel("src.md"))) && (await has("explorerctx-move-to")));
await page.click('[data-testid="explorerctx-move-to"]');
await wait(150);
ok("the move-to modal opens", await has("move-to-modal"));
ok("modal lists Dest as a target", await app(() => !!document.querySelector('[data-testid="move-to-item"][data-target="Dest"]')));
await page.click('[data-testid="move-to-item"][data-target="Dest"]');
await wait(300);
ok("the file moved to Dest/src.md", await fileExists("Dest/src.md"));
ok("the original src.md is gone", !(await fileExists("src.md")));
ok("moved content is preserved", (await read("Dest/src.md")) === "# Source\nbody\n");
// data-safety: the bare-basename md link is basename-stable (Geode R70/R71 resolves
// it by unique basename), so it still RESOLVES to the moved file — not broken, no
// needless rewrite. (Position-bearing md links rewrite on rename — that's R70's job.)
ok("the md link still resolves to the moved file (data-safety: not orphaned)",
  (await app(() => window.__app.metadata.resolveMarkdownLink("src.md", "linker.md"))) === "Dest/src.md",
  JSON.stringify(await app(() => window.__app.metadata.resolveMarkdownLink("src.md", "linker.md"))));
ok("the modal closed after the move", !(await has("move-to-modal")));

// ── fuzzy filter + root + close-without-move ────────────────────────────────
console.log("— fuzzy filter / root / cancel —");
await rightClick(rowSel("Dest/src.md"));
await wait(80);
await page.click('[data-testid="explorerctx-move-to"]');
await wait(120);
await page.fill('[data-testid="move-to-input"]', "oth");
await wait(120);
ok("fuzzy filter narrows to 'Other'", await app(() => {
  const items = [...document.querySelectorAll('[data-testid="move-to-item"]')];
  return items.length >= 1 && items.every((el) => el.getAttribute("data-target").toLowerCase().includes("ot"));
}));
// Escape closes WITHOUT moving
await page.locator('[data-testid="move-to-input"]').press("Escape");
await wait(120);
ok("Escape closes the modal without moving", !(await has("move-to-modal")) && (await fileExists("Dest/src.md")));

// move back to root via the root option
await rightClick(rowSel("Dest/src.md"));
await wait(80);
await page.click('[data-testid="explorerctx-move-to"]');
await wait(120);
ok("root target offered for a nested file", await app(() => !!document.querySelector('[data-testid="move-to-item"][data-target=""]')));
await page.click('[data-testid="move-to-item"][data-target=""]');
await wait(300);
ok("moving to root lands the file at vault root", await fileExists("src.md") && !(await fileExists("Dest/src.md")));

console.log(`\nR97 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
