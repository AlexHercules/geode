/**
 * R111 compat binary IO E2E — browser mode :1420.
 * Run: node .calibration/r111-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 111 additions" (㊵ 续 → compat 商业主轴).
 *
 * The Obsidian compat shim (`window.app`, set by the plugin loader) now bridges binary IO to
 * Geode's native binary read/create — Vault.readBinary/createBinary + DataAdapter.readBinary/
 * writeBinary (image/PDF/Excalidraw plugins). Binary OVERWRITE is real since R120 (Vault.modifyBinary,
 * atomic tmp+rename); DataAdapter.writeBinary creates-or-overwrites since R122.
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
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r111", name: "r111", onload(app) { window.__app = app; } }));
// window.app = the compat Obsidian App (set by the plugin loader)
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.vault && typeof window.app.vault.readBinary === "function", null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);

// ── compat Vault.createBinary → readBinary round-trip ───────────────────────
console.log("— compat Vault binary round-trip —");
const rt = await app(async () => {
  const v = window.app.vault;
  const data = new Uint8Array([10, 20, 30, 255]).buffer;
  const file = await v.createBinary("r111compat.bin", data);
  const back = await v.readBinary(window.app.vault.getFileByPath("r111compat.bin"));
  return { tfilePath: file?.path, bytes: [...new Uint8Array(back)], hasExt: file?.extension };
});
ok("compat vault.createBinary returns a TFile (path + extension)", rt.tfilePath === "r111compat.bin" && rt.hasExt === "bin", JSON.stringify(rt));
ok("compat vault.readBinary round-trips the exact bytes", eq(rt.bytes, [10, 20, 30, 255]), JSON.stringify(rt.bytes));

// ── compat readBinary bridges to Geode's NATIVE binary IO ───────────────────
console.log("— bridges to native core binary IO —");
await app(async () => { try { await window.__app.vault.createBinary("r111bridge.bin", new Uint8Array([1, 2, 3])); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); });
const bridge = await app(async () => [...new Uint8Array(await window.app.vault.adapter.readBinary("r111bridge.bin"))]);
ok("compat adapter.readBinary reads a file created by core (real bridge)", eq(bridge, [1, 2, 3]), JSON.stringify(bridge));
const vaultBridge = await app(async () => [...new Uint8Array(await window.app.vault.readBinary(window.app.vault.getFileByPath("r111bridge.bin")))]);
ok("compat vault.readBinary reads a core-created binary", eq(vaultBridge, [1, 2, 3]), JSON.stringify(vaultBridge));

// ── compat DataAdapter.writeBinary creates (round-trips) ─────────────────────
console.log("— compat adapter.writeBinary —");
const adapterRt = await app(async () => {
  await window.app.vault.adapter.writeBinary("r111adapter.bin", new Uint8Array([7, 8, 9]).buffer);
  return [...new Uint8Array(await window.app.vault.adapter.readBinary("r111adapter.bin"))];
});
ok("compat adapter.writeBinary creates + readBinary round-trips", eq(adapterRt, [7, 8, 9]), JSON.stringify(adapterRt));
ok("the adapter-written binary is visible to core (one vault)", await app(() => window.__app.vault.fileExists("r111adapter.bin")));

// ── returned ArrayBuffer is a COPY (no aliasing the internal store) ─────────
console.log("— readBinary returns a copy (no aliasing) —");
const isolated = await app(async () => {
  const a = await window.app.vault.readBinary(window.app.vault.getFileByPath("r111compat.bin"));
  new Uint8Array(a)[0] = 99; // mutate the returned buffer
  const b = await window.app.vault.readBinary(window.app.vault.getFileByPath("r111compat.bin"));
  return [...new Uint8Array(b)]; // must be unchanged
});
ok("mutating the returned ArrayBuffer does NOT corrupt the store", eq(isolated, [10, 20, 30, 255]), JSON.stringify(isolated));

// ── modifyBinary now OVERWRITES (R120 — atomic tmp+rename; superseded the R111 gap) ──
console.log("— binary overwrite via modifyBinary (R120) —");
const modOk = await app(async () => {
  try { await window.app.vault.modifyBinary(window.app.vault.getFileByPath("r111compat.bin"), new Uint8Array([1]).buffer); return true; }
  catch { return false; }
});
ok("vault.modifyBinary overwrites an existing binary (R120, no longer a gap)", modOk);
const overwriteBytes = await app(async () => {
  await window.app.vault.adapter.writeBinary("r111compat.bin", new Uint8Array([42, 43]).buffer);
  return [...new Uint8Array(await window.app.vault.adapter.readBinary("r111compat.bin"))];
});
ok("adapter.writeBinary on an EXISTING path OVERWRITES atomically (R122) → [42,43]", JSON.stringify(overwriteBytes) === JSON.stringify([42, 43]), JSON.stringify(overwriteBytes));

// ── path traversal is rejected (R111 review MAJOR: core createBinary now guards) ──
console.log("— untrusted plugin path is guarded (no `..`/absolute escape) —");
const escapeThrew = await app(async () => {
  try { await window.app.vault.createBinary("../escape.bin", new Uint8Array([1]).buffer); return false; }
  catch { return true; }
});
ok("compat vault.createBinary rejects a `..` escape path (core assertSafeRelPath)", escapeThrew);
const adapterEscapeThrew = await app(async () => {
  try { await window.app.vault.adapter.writeBinary("/abs/escape.bin", new Uint8Array([1]).buffer); return false; }
  catch { return true; }
});
ok("compat adapter.writeBinary rejects an absolute escape path", adapterEscapeThrew);
const notLeaked = await app(() => !window.__app.vault.fileExists("../escape.bin") && !window.__app.vault.fileExists("/abs/escape.bin"));
ok("no escape file leaked into the store", notLeaked);

console.log(`\nR111 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
