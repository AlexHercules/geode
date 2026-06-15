/**
 * R84 graph filters E2E — browser mode against dev :1420.
 * Run: node .calibration/r84-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 84 additions" (㊵ filters).
 *
 * Covers applyGraphFilters (via __geodeGraphFilter) — orphans / existing-only /
 * combined — parseGraphPrefs filters backward-compat, and the two settings-panel
 * toggles persisting + changing the rendered node set. Pure client-side, no writes.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r84", name: "r84", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeGraphFilter && !!window.__geodeGraphPrefs, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const gp = (raw) => app(([r]) => window.__geodeGraphPrefs(r), [raw]);
const gf = (nodes, edges, filters) => app(([n, e, f]) => window.__geodeGraphFilter(n, e, f), [nodes, edges, filters]);
const lsPrefs = () => app(() => { try { return JSON.parse(localStorage.getItem("geode.graphPrefs")); } catch { return null; } });
const legendCount = () => app(() => {
  const el = document.querySelector('[data-testid="graph-legend"]');
  const m = el?.textContent?.match(/\d[\d,]*/);
  return m ? Number(m[0].replace(/,/g, "")) : null;
});

// ── applyGraphFilters truth table (probe hook) ──────────────────────────────
console.log("— applyGraphFilters —");
const nodes = [
  { id: "a", resolved: true },
  { id: "b", resolved: true },
  { id: "c", resolved: true },          // orphan (no edges)
  { id: "unresolved:Ghost", resolved: false },
];
const edges = [
  { source: "a", target: "b" },
  { source: "a", target: "unresolved:Ghost" },
];
ok("default (orphans on, existingOnly off) keeps all 4",
  JSON.stringify(await gf(nodes, edges, { orphans: true, existingOnly: false })) === '["a","b","c","unresolved:Ghost"]');
ok("existingOnly drops the unresolved Ghost node",
  JSON.stringify(await gf(nodes, edges, { orphans: true, existingOnly: true })) === '["a","b","c"]');
ok("orphans off drops the degree-0 node c (Ghost kept, degree 1)",
  JSON.stringify(await gf(nodes, edges, { orphans: false, existingOnly: false })) === '["a","b","unresolved:Ghost"]');
ok("combined: existingOnly then orphans → only a,b",
  JSON.stringify(await gf(nodes, edges, { orphans: false, existingOnly: true })) === '["a","b"]');

// ── parseGraphPrefs filters backward-compat ─────────────────────────────────
console.log("— parseGraphPrefs filters —");
const oldBlob = await gp('{"mode":"local","depth":2,"showAll":true}');
ok("old blob (no filters) → orphans default true", oldBlob.filters.orphans === true, JSON.stringify(oldBlob.filters));
ok("old blob (no filters) → existingOnly default false", oldBlob.filters.existingOnly === false, JSON.stringify(oldBlob.filters));
const explicit = await gp('{"filters":{"orphans":false,"existingOnly":true}}');
ok("explicit filters preserved", explicit.filters.orphans === false && explicit.filters.existingOnly === true, JSON.stringify(explicit.filters));
const corrupt = await gp("}{nope");
ok("corrupt blob → filters default to show-all", corrupt.filters.orphans === true && corrupt.filters.existingOnly === false, JSON.stringify(corrupt.filters));

// ── settings panel toggles change the rendered node set ─────────────────────
console.log("— filter toggles in the panel —");
// fa → fb (resolved) + fa → Ghost (unresolved); fc is an orphan
await create("fa.md", "[[fb]] and [[Ghost]]\n");
await create("fb.md", "hi\n");
await create("fc.md", "lonely note, no links\n");
await wait(250);
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 500)); });
ok("graph view mounts", await app(() => !!document.querySelector('[data-testid="graph-view"]')));
await page.locator('[data-testid="graph-settings-toggle"]').click();
await wait(150);
ok("filter toggles present", await app(() =>
  !!document.querySelector('[data-testid="graph-filter-orphans"]') && !!document.querySelector('[data-testid="graph-filter-existing"]')));
// (MemoryVault ships seed notes, so assert directional deltas, not absolutes)
const base = await legendCount();
ok("baseline graph has nodes", base !== null && base >= 4, String(base));

// existing-files-only → drops unresolved nodes (incl. our Ghost) → fewer nodes
await page.locator('[data-testid="graph-filter-existing"]').click();
await wait(300);
ok("existingOnly persists to localStorage", (await lsPrefs())?.filters?.existingOnly === true);
const afterExisting = await legendCount();
ok("existingOnly removes unresolved nodes (count drops)", afterExisting < base, `${afterExisting} < ${base}`);
// turn it back off → unresolved nodes return → back to baseline
await page.locator('[data-testid="graph-filter-existing"]').click();
await wait(300);
ok("toggling existingOnly off restores the baseline count", (await legendCount()) === base, `${await legendCount()} vs ${base}`);

// orphans off → drops degree-0 nodes (incl. our fc) → fewer nodes
await page.locator('[data-testid="graph-filter-orphans"]').click();
await wait(300);
ok("orphans persists to localStorage (false)", (await lsPrefs())?.filters?.orphans === false);
const afterOrphans = await legendCount();
ok("orphans off removes disconnected nodes (count drops)", afterOrphans < base, `${afterOrphans} < ${base}`);

// both filters on → fewest nodes (≤ either single filter)
await page.locator('[data-testid="graph-filter-existing"]').click();
await wait(300);
const afterBoth = await legendCount();
ok("both filters → fewest nodes (≤ each single filter)",
  afterBoth <= afterExisting && afterBoth <= afterOrphans, `${afterBoth} ≤ min(${afterExisting},${afterOrphans})`);

console.log(`\nR84 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
