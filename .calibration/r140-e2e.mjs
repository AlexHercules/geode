/**
 * R140 Explorer bulk operations (multi-select delete + move) E2E — browser mode :1420.
 * Run: node .calibration/r140-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 140 additions".
 *
 * Right-click a multi-selection → built-in Delete N (confirm → trash each ROOT, dedup-to-roots so a
 * folder + its child only trashes the folder) / Move N (→ MoveToModal → move all into a folder,
 * same-basename collisions skipped via the adapter throw). Reuses the vetted R42 trash / R16 move.
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
page.on("dialog", (d) => d.accept()); // accept the bulk-delete confirm
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r140", name: "r140", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const row = (p) => `[data-testid="explorer-item"][data-path="${p}"]`;
const fileExists = (p) => app(([x]) => !!window.__app.vault.fileExists(x), [p]);
const folderExists = (p) => app(([x]) => !!window.__app.vault.folderExists(x), [p]);
const clearSel = () => page.locator(".explorer-tree").press("Escape");
const cmdClick = async (...paths) => { for (const p of paths) await page.click(row(p), { modifiers: ["ControlOrMeta"] }); };
const has = (testid) => app(([id]) => !!document.querySelector(`[data-testid="${id}"]`), [testid]);

// create a working set
await app(async () => {
  const v = window.__app.vault;
  for (const n of ["bda", "bdb", "bdc", "bma", "bmb", "dda", "ddb"]) { try { await v.create(n + ".md", "# " + n + "\n"); } catch { /* exists */ } }
  try { await v.createFolder("df"); } catch { /* exists */ }
  try { await v.create("df/dy.md", "# dy\n"); } catch { /* exists */ }
  try { await v.createFolder("dest"); } catch { /* exists */ }
});
await page.waitForSelector(row("bda.md"), { timeout: 5000 });

console.log("— a multi-selection ALWAYS opens the multi-file menu with built-in Delete/Move (R139 gate dropped) —");
await clearSel();
await cmdClick("dda.md", "ddb.md");
await page.click(row("dda.md"), { button: "right" });
await page.waitForSelector('[data-testid="explorer-menu"]', { timeout: 3000 });
ok("multi menu shows the built-in Delete N (no plugin handler needed)", await has("explorerctx-bulk-delete"));
ok("multi menu shows the built-in Move N", await has("explorerctx-bulk-move"));
ok("multi menu shows the {count} header (2)", (await app(() => document.querySelector('[data-testid="explorerctx-files-count"]')?.textContent ?? "")).includes("2"));
ok("multi menu does NOT show the single-file Rename", !(await has("explorerctx-rename")));
await page.keyboard.press("Escape");

console.log("— bulk delete: Delete N trashes every selected file (confirm accepted), others untouched —");
await clearSel();
await cmdClick("bda.md", "bdb.md");
await page.click(row("bda.md"), { button: "right" });
await page.waitForSelector('[data-testid="explorerctx-bulk-delete"]', { timeout: 3000 });
await page.click('[data-testid="explorerctx-bulk-delete"]');
await wait(300);
ok("bda.md trashed (gone from vault)", (await fileExists("bda.md")) === false);
ok("bdb.md trashed (gone from vault)", (await fileExists("bdb.md")) === false);
ok("bdc.md (unselected) still exists", (await fileExists("bdc.md")) === true);

console.log("— dedup-to-roots: deleting a folder + its child only trashes the folder (no 'already gone' error) —");
await clearSel();
await page.click(row("df")); // plain click → opens + selects {df}
await wait(80);
await page.waitForSelector(row("df/dy.md"), { timeout: 3000 });
await page.click(row("df/dy.md"), { modifiers: ["ControlOrMeta"] }); // add child → {df, df/dy.md}
await page.click(row("df"), { button: "right" });
await page.waitForSelector('[data-testid="explorerctx-bulk-delete"]', { timeout: 3000 });
const errsBefore = pageErrors.length;
await page.click('[data-testid="explorerctx-bulk-delete"]');
await wait(300);
ok("the folder df is trashed", (await folderExists("df")) === false);
ok("its child df/dy.md is gone (with the folder)", (await fileExists("df/dy.md")) === false);
ok("no error from double-trashing the child (dedup-to-roots worked)", pageErrors.length === errsBefore, pageErrors.slice(errsBefore).join(" | "));

console.log("— bulk move: Move N moves the whole selection into the chosen folder —");
await clearSel();
await cmdClick("bma.md", "bmb.md");
await page.click(row("bma.md"), { button: "right" });
await page.waitForSelector('[data-testid="explorerctx-bulk-move"]', { timeout: 3000 });
await page.click('[data-testid="explorerctx-bulk-move"]');
await page.waitForSelector('[data-testid="move-to-modal"]', { timeout: 3000 });
await page.click('[data-testid="move-to-item"][data-target="dest"]');
await wait(300);
ok("bma.md moved into dest/", (await fileExists("dest/bma.md")) === true && (await fileExists("bma.md")) === false);
ok("bmb.md moved into dest/", (await fileExists("dest/bmb.md")) === true && (await fileExists("bmb.md")) === false);

console.log("— bulk move same-basename collision: one moves, the other is SKIPPED (not overwritten) —");
await app(async () => {
  const v = window.__app.vault;
  for (const f of ["ca", "cb", "cdest"]) { try { await v.createFolder(f); } catch { /* exists */ } }
  try { await v.create("ca/dup.md", "CONTENT_A\n"); } catch { /* exists */ }
  try { await v.create("cb/dup.md", "CONTENT_B\n"); } catch { /* exists */ }
});
await page.waitForSelector(row("ca"), { timeout: 5000 });
await page.click(row("ca")); await wait(60); // expand ca
await page.click(row("cb")); await wait(60); // expand cb
await clearSel();
await page.waitForSelector(row("ca/dup.md"), { timeout: 3000 });
await cmdClick("ca/dup.md", "cb/dup.md"); // selection order → ca/dup.md moves first, cb/dup.md collides
await page.click(row("ca/dup.md"), { button: "right" });
await page.waitForSelector('[data-testid="explorerctx-bulk-move"]', { timeout: 3000 });
await page.click('[data-testid="explorerctx-bulk-move"]');
await page.waitForSelector('[data-testid="move-to-modal"]', { timeout: 3000 });
await page.click('[data-testid="move-to-item"][data-target="cdest"]');
await wait(300);
ok("one same-basename file moved into cdest/", (await fileExists("cdest/dup.md")) === true);
ok("the colliding file was SKIPPED — still on disk, NOT overwritten", (await fileExists("cb/dup.md")) === true);
ok("the skipped file kept its content (no overwrite/loss)", (await app(() => window.__app.vault.read("cb/dup.md"))).includes("CONTENT_B"));
ok("ca/dup.md was the one that moved (gone from source)", (await fileExists("ca/dup.md")) === false);
ok("a 'Moved 1, skipped 1' partial notice is shown", (await app(() => document.querySelector('[data-testid="link-update-notice"]')?.textContent ?? "")).match(/1/g)?.length >= 2);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR140 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
