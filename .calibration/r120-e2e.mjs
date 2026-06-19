/**
 * R120 compat Vault.modifyBinary E2E — browser mode :1420.
 * Run: node .calibration/r120-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 120 additions" (compat 商业主轴, 收 R111 显式 gap).
 *
 * Obsidian Vault.modifyBinary(file, ArrayBuffer) OVERWRITES an existing binary file. Geode core
 * modifyBinary writes via tmp + rename (atomic — a mid-write crash never truncates the existing
 * file), so a different-length overwrite leaves NO leftover bytes. createBinary stays create-only
 * (R111); modifyBinary is the overwrite path.
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
await page.waitForFunction(() => !!window.geode && !!window.app && !!window.app.vault && typeof window.app.vault.modifyBinary === "function", null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r120", name: "r120", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);

// ── create → modify (overwrite) → read round-trip ───────────────────────────
console.log("— modifyBinary overwrites an existing binary —");
const rt = await app(async () => {
  const v = window.app.vault;
  await v.createBinary("r120.bin", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer);
  const ret = await v.modifyBinary(v.getFileByPath("r120.bin"), new Uint8Array([99, 88, 77]).buffer);
  const back = await v.readBinary(v.getFileByPath("r120.bin"));
  return { ret, bytes: [...new Uint8Array(back)] };
});
ok("modifyBinary returns undefined (Promise<void>)", rt.ret === undefined);
ok("a SHORTER overwrite leaves NO leftover bytes (10→3 = exactly [99,88,77])", eq(rt.bytes, [99, 88, 77]), JSON.stringify(rt.bytes));

console.log("— grow + exact-byte overwrite —");
const grow = await app(async () => {
  const v = window.app.vault;
  await v.modifyBinary(v.getFileByPath("r120.bin"), new Uint8Array([10, 20, 30, 40, 50, 60, 255, 0]).buffer);
  return [...new Uint8Array(await v.readBinary(v.getFileByPath("r120.bin")))];
});
ok("a LONGER overwrite yields exactly the new bytes (3→8)", eq(grow, [10, 20, 30, 40, 50, 60, 255, 0]), JSON.stringify(grow));

console.log("— modifyBinary does not throw on an existing file (unlike createBinary) —");
const overwriteOk = await app(async () => {
  try { await window.app.vault.modifyBinary(window.app.vault.getFileByPath("r120.bin"), new Uint8Array([1]).buffer); return true; }
  catch { return false; }
});
ok("modifyBinary succeeds on an EXISTING file (overwrite, no throw)", overwriteOk);
const createStillThrows = await app(async () => {
  try { await window.app.vault.createBinary("r120.bin", new Uint8Array([1]).buffer); return false; }
  catch { return true; }
});
ok("createBinary still THROWS on existing (R111 create-only intact)", createStillThrows);

console.log("— returned ArrayBuffer is a copy + bytes survive ───────────────");
const isolated = await app(async () => {
  const v = window.app.vault;
  const a = await v.readBinary(v.getFileByPath("r120.bin"));
  new Uint8Array(a)[0] = 123; // mutate the returned buffer
  const b = await v.readBinary(v.getFileByPath("r120.bin"));
  return [...new Uint8Array(b)];
});
ok("mutating a read buffer does NOT corrupt the store (1-byte file = [1])", eq(isolated, [1]), JSON.stringify(isolated));

console.log("— path guard: untrusted overwrite path rejected —");
const escapeThrew = await app(async () => {
  try { await window.app.vault.modifyBinary({ path: "../escape.bin" }, new Uint8Array([1]).buffer); return false; }
  catch { return true; }
});
ok("modifyBinary rejects a `..` escape path (core assertSafeRelPath)", escapeThrew);
ok("no escape file leaked into the store", await app(() => !window.__app.vault.fileExists("../escape.bin")));

console.log(`\nR120 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
