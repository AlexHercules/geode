/**
 * R276 — Graph Obsidian-style circular force-directed layout E2E.
 * Reference: docs/ARCHITECTURE.md "Round 276 additions".
 *
 * Locks:
 *   - parseGraphPrefs backward-compat adds forces.circle = 0.06 and clamps it
 *   - Settings panel shows the Circle force slider after Center force
 *   - Slider persists to localStorage; Reset restores default
 *   - Global graph settles into a roughly circular envelope (aspect ratio 0.75–1.33)
 *   - Hub nodes end up with smaller median radius than leaves
 *   - Local graph mode still works and is not broken by the new force
 *
 * Run: node .calibration/r276-e2e.mjs   (dev server :1420 up)
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r276", name: "r276", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeGraphPrefs, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const gp = (raw) => app(([r]) => window.__geodeGraphPrefs(r), [raw]);
const lsPrefs = () => app(() => { try { return JSON.parse(localStorage.getItem("geode.graphPrefs")); } catch { return null; } });
const layoutStats = () => app(() => window.__geodeGraphLayoutStats?.() ?? null);
const setRange = (testid, value) => app(([id, v]) => {
  const el = document.querySelector(`[data-testid="${id}"]`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, String(v));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, [testid, value]);

function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── parseGraphPrefs: circle default + clamp ─────────────────────────────────
console.log("— parseGraphPrefs —");
const old = await gp('{"mode":"global","showAll":false}');
ok("old blob → forces.circle defaults to 0.06", old.forces.circle === 0.06, JSON.stringify(old.forces));
const low = await gp('{"forces":{"circle":-1}}');
ok("circle < min clamped to 0", low.forces.circle === 0, JSON.stringify(low.forces));
const high = await gp('{"forces":{"circle":999}}');
ok("circle > max clamped to 0.25", high.forces.circle === 0.25, JSON.stringify(high.forces));

// ── settings panel: circle slider position + persistence + reset ────────────
console.log("— settings panel —");
await create("ga.md", "[[gb]]\n");
await create("gb.md", "hi\n");
await wait(200);
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 400)); });
await page.locator('[data-testid="graph-settings-toggle"]').click();
await wait(150);
ok("circle slider exists", await app(() => !!document.querySelector('[data-testid="graph-force-circle"]')));
ok("circle slider follows center slider", await app(() => {
  const labels = [...document.querySelectorAll('.graph-slider-label')].map((n) => n.textContent);
  const centerIdx = labels.indexOf("Center force");
  const circleIdx = labels.indexOf("Circle force");
  return centerIdx >= 0 && circleIdx === centerIdx + 1;
}));

await setRange("graph-force-circle", 0.15);
await wait(150);
let prefs = await lsPrefs();
ok("circle slider → localStorage forces.circle = 0.15", prefs?.forces?.circle === 0.15, JSON.stringify(prefs?.forces));

await page.locator('[data-testid="graph-settings-reset"]').click();
await wait(150);
prefs = await lsPrefs();
ok("reset → circle back to default 0.06", prefs?.forces?.circle === 0.06, JSON.stringify(prefs?.forces));

await page.locator('[data-testid="graph-settings-toggle"]').click();
await wait(120);

// ── circular layout metrics on a deterministic fixture ──────────────────────
console.log("— circular layout metrics —");
// build a hub-and-spoke + chain + orphan fixture
await app(() => window.__app.vault.create("r276-hub.md", "[[r276-a]] [[r276-b]] [[r276-c]] [[r276-d]] [[r276-e]]\n"));
for (const x of ["a", "b", "c", "d", "e"]) {
  await app(([letter]) => window.__app.vault.create(`r276-${letter}.md`, `[[r276-hub]] [[r276-${letter}-1]] [[r276-${letter}-2]]\n`), [x]);
  await app(([letter]) => window.__app.vault.create(`r276-${letter}-1.md`, `[[r276-${letter}]] [[r276-${letter}-3]]\n`), [x]);
  await app(([letter]) => window.__app.vault.create(`r276-${letter}-2.md`, `[[r276-${letter}]]\n`), [x]);
  await app(([letter]) => window.__app.vault.create(`r276-${letter}-3.md`, `[[r276-${letter}-1]]\n`), [x]);
}
await app(() => window.__app.vault.create("r276-orphan.md", "no links\n"));
await wait(300);
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 400)); });
// wait for nodes to appear and then let the radial force shape the envelope
await page.waitForFunction(() => {
  const stats = window.__geodeGraphLayoutStats?.();
  return stats && stats.nodeCount >= 15;
}, null, { timeout: 15000 });
await wait(2200);

let stats = await layoutStats();
ok("global graph has nodes", stats && stats.nodeCount >= 15, JSON.stringify(stats));
ok("aspect ratio roughly circular (0.75–1.33)", stats && stats.aspectRatio >= 0.75 && stats.aspectRatio <= 1.33, JSON.stringify(stats));
ok("settled positions are stable (non-zero hash)", stats && stats.positionsHash !== 0, JSON.stringify(stats));

// hub (degree 5) should be closer to center than leaves (degree 1)
const nodes = stats?.nodes ?? [];
const hubRadii = nodes.filter((n) => n.id === "r276-hub.md").map((n) => n.radius);
const leafRadii = nodes.filter((n) => n.id.endsWith("-2.md") || n.id.endsWith("-3.md")).map((n) => n.radius);
ok("hub radius is measured", hubRadii.length === 1, JSON.stringify(hubRadii));
ok("leaf radii are measured", leafRadii.length >= 5, JSON.stringify(leafRadii.length));
if (hubRadii.length && leafRadii.length) {
  const hubMed = median(hubRadii);
  const leafMed = median(leafRadii);
  ok("hub median radius < leaf median radius (hubs in, leaves out)", hubMed < leafMed, `hub=${hubMed} leaf=${leafMed}`);
}

// ── local graph still works; circle force only global ───────────────────────
console.log("— local graph regression —");
await app(() => { window.__app.workspace.lastActiveFile.set("r276-hub.md"); });
await app(() => { window.__app.workspace.openLocalGraphRequest.set(true); });
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 400)); });
await wait(2200);
const localStats = await layoutStats();
ok("local graph renders nodes", localStats && localStats.nodeCount >= 3, JSON.stringify(localStats));

console.log(`\nR276 e2e: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
