/**
 * R78 graph settings E2E — browser mode against dev :1420.
 * Run: node .calibration/r78-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 78 additions" (㊵).
 *
 * Covers parseGraphPrefs (via __geodeGraphPrefs) — clamp / backward-compat /
 * corrupt — AND the settings panel: gear toggles it, force/display sliders +
 * arrows toggle persist into localStorage geode.graphPrefs, reset restores defaults.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r78", name: "r78", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeGraphPrefs, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const gp = (raw) => app(([r]) => window.__geodeGraphPrefs(r), [raw]);
const lsPrefs = () => app(() => { try { return JSON.parse(localStorage.getItem("geode.graphPrefs")); } catch { return null; } });
// set a range input's value the React-aware way (native setter + input event)
const setRange = (testid, value) => app(([id, v]) => {
  const el = document.querySelector(`[data-testid="${id}"]`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, String(v));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, [testid, value]);

// ── parseGraphPrefs validation (via probe hook) ─────────────────────────────
console.log("— parseGraphPrefs —");
const clamp = await gp('{"forces":{"repel":99999,"center":-5},"display":{"nodeSize":0.1}}');
ok("out-of-range repel clamped to max 600", clamp.forces.repel === 600, JSON.stringify(clamp.forces));
ok("out-of-range center clamped to min 0", clamp.forces.center === 0, JSON.stringify(clamp.forces));
ok("out-of-range nodeSize clamped to min 0.5", clamp.display.nodeSize === 0.5, JSON.stringify(clamp.display));
const old = await gp('{"mode":"local","depth":2,"showAll":true}');
ok("old {mode,depth,showAll} blob → forces/display default in (backward compat)", old.forces.repel === 200 && old.display.nodeSize === 1 && old.mode === "local" && old.depth === 2, JSON.stringify(old));
const corrupt = await gp("}{not json");
ok("corrupt blob → all defaults", corrupt.forces.linkDistance === 70 && corrupt.display.arrows === false, JSON.stringify(corrupt));

// ── settings panel: open, sliders persist ───────────────────────────────────
console.log("— settings panel —");
await create("ga.md", "[[gb]]\n");
await create("gb.md", "hi\n");
await wait(200);
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 400)); });
ok("graph view mounts", await app(() => !!document.querySelector('[data-testid="graph-view"]')));
ok("gear button present", await app(() => !!document.querySelector('[data-testid="graph-settings-toggle"]')));
ok("panel hidden until gear clicked", await app(() => !document.querySelector('[data-testid="graph-settings"]')));
await page.locator('[data-testid="graph-settings-toggle"]').click();
await wait(150);
ok("gear opens the settings panel", await app(() => !!document.querySelector('[data-testid="graph-settings"]')));

// force slider persists
await setRange("graph-force-repel", 400);
await wait(150);
let prefs = await lsPrefs();
ok("repel slider → localStorage forces.repel = 400", prefs?.forces?.repel === 400, JSON.stringify(prefs?.forces));
await setRange("graph-link-distance", 120);
await wait(150);
prefs = await lsPrefs();
ok("link-distance slider → localStorage forces.linkDistance = 120", prefs?.forces?.linkDistance === 120, JSON.stringify(prefs?.forces));

// display slider persists
await setRange("graph-node-size", 2);
await wait(150);
prefs = await lsPrefs();
ok("node-size slider → localStorage display.nodeSize = 2", prefs?.display?.nodeSize === 2, JSON.stringify(prefs?.display));

// arrows toggle
await page.locator('[data-testid="graph-arrows"]').click();
await wait(150);
prefs = await lsPrefs();
ok("arrows checkbox → localStorage display.arrows = true", prefs?.display?.arrows === true, JSON.stringify(prefs?.display));

// ── reset restores defaults ─────────────────────────────────────────────────
console.log("— reset —");
await page.locator('[data-testid="graph-settings-reset"]').click();
await wait(150);
prefs = await lsPrefs();
ok("reset → forces back to defaults", prefs?.forces?.repel === 200 && prefs?.forces?.linkDistance === 70, JSON.stringify(prefs?.forces));
ok("reset → display back to defaults", prefs?.display?.nodeSize === 1 && prefs?.display?.arrows === false, JSON.stringify(prefs?.display));

// ── gear closes ─────────────────────────────────────────────────────────────
await page.locator('[data-testid="graph-settings-toggle"]').click();
await wait(120);
ok("gear toggles panel closed", await app(() => !document.querySelector('[data-testid="graph-settings"]')));

console.log(`\nR78 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
