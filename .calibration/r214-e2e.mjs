/**
 * R214 — G3 §10: app:show-file-properties command reveals the R86 FilePropertiesPanel
 * (current note's properties). Obsidian's "Show file properties" core command — the twin
 * of "Show all properties" (app:show-all-properties). Geode had the panel (right-tab only)
 * but no command. Browser :1420.  Run: node .calibration/r214-e2e.mjs
 * Contract: ARCHITECTURE "Round 214 additions".
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r214", name: "r214", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tabActive = (testid) => app((t) => { const el = document.querySelector(`[data-testid="${t}"]`); return !!el && el.className.includes("is-active"); }, testid);

console.log("A. command registration (name resolves, no default hotkey)");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "app:show-file-properties");
  return { present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey("app:show-file-properties") || null };
});
ok("app:show-file-properties registered", reg.present, JSON.stringify(reg));
ok("name resolves via i18n (not the raw key)", !!reg.name && reg.name === "Properties view: Show file properties", JSON.stringify(reg));
ok("no default hotkey", reg.hotkey === null);

await app(async () => { try { await window.__app.vault.create("Doc.md", "---\ncount: 1\n---\nbody\n"); } catch { /* exists */ } });
await wait(200);
await app(() => window.__app.workspace.openFile("Doc.md"));
await wait(150);

console.log("B. executing it reveals the FilePropertiesPanel (current note's properties)");
await app(() => window.__app.commands.execute("app:show-file-properties"));
await page.waitForSelector('[data-testid="fileproperties-panel"]', { timeout: 4000 }).catch(() => {});
ok("file-properties panel shown", (await page.$('[data-testid="fileproperties-panel"]')) !== null);
ok("right-tab-fileproperties is the active right tab", await tabActive("right-tab-fileproperties"));
ok("shows the current note's property rows (count)",
  await app(() => !!document.querySelector('[data-testid="fileproperties-panel"] [data-testid="property-row-count"]')));

console.log("C. distinct from app:show-all-properties (file vs all)");
await app(() => window.__app.commands.execute("app:show-all-properties"));
await wait(150);
ok("show-all-properties switches AWAY from file-properties", (await page.$('[data-testid="fileproperties-panel"]')) === null);
ok("right-tab-allproperties is now active", await tabActive("right-tab-allproperties"));
await app(() => window.__app.commands.execute("app:show-file-properties"));
await wait(150);
ok("show-file-properties switches back to the file-properties panel", (await page.$('[data-testid="fileproperties-panel"]')) !== null);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR214: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
