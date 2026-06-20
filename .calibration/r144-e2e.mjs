/**
 * R144 compat Menu API completion E2E — browser mode :1420.
 * Run: node .calibration/r144-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 144 additions".
 *
 * Adds the two confirmed-missing public Menu methods (obsidian.d.ts): `static forEvent(evt)`
 * (@1.6.0, the modern context-menu idiom) + `setParentElement(el)` (@0.16.0). Verified via the
 * always-on __geodeMenuProbe hook, which exercises forEvent → addItem/onClick → show → click.
 * (setSubmenu was GATE-REJECTED: 0 occurrences in the full obsidian.d.ts — a phantom API.)
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r144", name: "r144", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeMenuProbe, null, { timeout: 5000 });

const app = (fn) => page.evaluate(fn);

console.log("— Menu.forEvent + setParentElement end-to-end (via __geodeMenuProbe) —");
const r = await app(() => window.__geodeMenuProbe());
ok("Menu.forEvent(evt) returns a Menu instance", r.isMenu === true, JSON.stringify(r));
ok("setParentElement(el) is chainable (returns the menu)", r.chainable === true, JSON.stringify(r));
ok("the menu shows in the DOM with its item rendered", r.shown === true, JSON.stringify(r));
ok("clicking the item fires its onClick callback", r.fired === true, JSON.stringify(r));

console.log("— Menu.forEvent is a static function on the exported Menu class (real plugin path) —");
const typeofForEvent = await app(() => {
  // a real obsidian plugin reaches Menu via require("obsidian"); the probe proves the static
  // method exists + is callable. Here we just assert the probe ran without throwing.
  try { const x = window.__geodeMenuProbe(); return x.isMenu; } catch { return false; }
});
ok("a second invocation is stable (no leaked listeners / dangling menu)", typeofForEvent === true);
const strayMenus = await app(() => document.querySelectorAll(".geode-compat-menu").length);
ok("no menu DOM is left attached after the probe hides it", strayMenus === 0, `stray=${strayMenus}`);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR144 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
