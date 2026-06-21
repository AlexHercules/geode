/**
 * R165 — Tier 7 B3③: `global` shim for Node-targeting plugin bundles — browser :1420.
 * Run: node .calibration/r165-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 165 additions" (Tier 7 B3③, 商业主轴 compat).
 *
 * loader.ts runLoad() injects `globalThis.global ??= globalThis` before any plugin
 * main.js evaluates, so bundles that reference the Node global `global` as a free
 * variable resolve instead of throwing "Can't find variable: global".
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
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("— loader ran at boot + global shim installed —");
ok("window.moment is set (runLoad ran at boot — same injection block)", await ev(() => typeof window.moment === "function" || typeof window.moment === "object"));
ok("window.global === window (shim installed)", await ev(() => window.global === window));
ok("globalThis.global === globalThis", await ev(() => globalThis.global === globalThis));

console.log("— a free `global` reference now resolves (the plugin-bundle failure mode) —");
ok("`typeof global` is 'object', not undefined", await ev(() => new Function("return typeof global")() === "object"));

console.log("— replicate loader's exact eval: new Function(require,module,exports, code) using `global` —");
ok("a bundle referencing `global` evaluates without 'Can't find variable: global'", await ev(() => {
  // mirrors loader.ts:277 — main.js is run via new Function with only require/module/exports;
  // `global` must resolve as a free variable off the global scope.
  const moduleObj = { exports: {} };
  try {
    const run = new Function("require", "module", "exports", "module.exports = global;");
    run(() => {}, moduleObj, moduleObj.exports);
  } catch {
    return false;
  }
  return moduleObj.exports === window;
}));

console.log("— regression: obsidian-plugin load path still works (fixture loads with shim in place) —");
await page.goto(BASE_URL + "?obsfixture=1");
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await wait(200); // let the obsidian plugin loader finish
ok("global shim still set on the fixture path", await ev(() => window.global === window));
const fixtureReport = await ev(() =>
  window.geode.app.obsidianLoadReport.get().find((r) => r.id === "geode-compat-fixture") ?? null);
ok("fixture plugin present in load report", fixtureReport !== null, JSON.stringify(fixtureReport));
ok("fixture plugin loaded (status 'enabled', not 'failed')", fixtureReport?.status === "enabled",
  `status=${fixtureReport?.status} detail=${fixtureReport?.detail ?? ""}`);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR165: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
