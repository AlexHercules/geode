/**
 * R122 compat DataAdapter.writeBinary create-or-overwrite E2E — browser mode :1420.
 * Run: node .calibration/r122-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 122 additions" (compat 商业主轴).
 *
 * Obsidian DataAdapter.writeBinary CREATES-OR-OVERWRITES. R122: try createBinary (create_new +
 * tree refresh for a NEW file); if the path exists, overwrite atomically via modifyBinary (R120
 * tmp+rename — no truncation). This e2e covers the LOGIC (create / overwrite / path-guard); the
 * real-fs atomicity (no leftover on a different-length overwrite) is the desktop probe's job (on
 * the Memory adapter, "no leftover" is tautological — see R120 lesson).
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.app && !!window.app.vault && !!window.app.vault.adapter, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r122", name: "r122", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);

console.log("— writeBinary CREATES a new file —");
const created = await app(async () => {
  const a = window.app.vault.adapter;
  await a.writeBinary("r122new.bin", new Uint8Array([1, 2, 3]).buffer);
  return { bytes: [...new Uint8Array(await a.readBinary("r122new.bin"))], inTree: window.__app.vault.fileExists("r122new.bin") };
});
ok("a NEW path is created with the bytes", eq(created.bytes, [1, 2, 3]), JSON.stringify(created.bytes));
ok("the new file appears in the vault tree (createBinary refreshTree path)", created.inTree === true);

console.log("— writeBinary OVERWRITES an existing file —");
const shrunk = await app(async () => {
  const a = window.app.vault.adapter;
  await a.writeBinary("r122new.bin", new Uint8Array([9, 8]).buffer); // shorter
  return [...new Uint8Array(await a.readBinary("r122new.bin"))];
});
ok("an EXISTING path is overwritten (10→… shorter = exactly [9,8], no throw)", eq(shrunk, [9, 8]), JSON.stringify(shrunk));
const grown = await app(async () => {
  const a = window.app.vault.adapter;
  await a.writeBinary("r122new.bin", new Uint8Array([5, 6, 7, 8, 255]).buffer); // longer
  return [...new Uint8Array(await a.readBinary("r122new.bin"))];
});
ok("a LONGER overwrite yields exactly the new bytes", eq(grown, [5, 6, 7, 8, 255]), JSON.stringify(grown));

console.log("— overwrite did not duplicate / leak —");
ok("the file is still a single entry (overwrite, not a new file)", await app(() => window.__app.vault.fileExists("r122new.bin")));

console.log("— writeBinary over a FOLDER path is rejected (no file/folder collision) —");
const folderThrew = await app(async () => {
  await window.__app.vault.createFolder("r122dir");
  try { await window.app.vault.adapter.writeBinary("r122dir", new Uint8Array([1]).buffer); return false; }
  catch { return true; }
});
ok("writeBinary on an existing FOLDER path throws (create→catch→modify both reject)", folderThrew);
ok("the folder is still a folder, not clobbered into a file", await app(() => window.__app.vault.folderExists("r122dir") && !window.__app.vault.fileExists("r122dir")));

console.log("— path guard: untrusted write path rejected —");
const escapeThrew = await app(async () => {
  try { await window.app.vault.adapter.writeBinary("../escape.bin", new Uint8Array([1]).buffer); return false; }
  catch { return true; }
});
ok("writeBinary rejects a `..` escape path (core assertSafeRelPath via both branches)", escapeThrew);
ok("no escape file leaked into the store", await app(() => !window.__app.vault.fileExists("../escape.bin")));

console.log(`\nR122 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
