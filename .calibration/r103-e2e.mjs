/**
 * R103 local-graph depth + incoming/outgoing E2E — browser mode :1420.
 * Run: node .calibration/r103-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 103 additions" (㊵ 续续续续续).
 *
 * Local graph gains depth 1–5 (was 1|2) + Incoming/Outgoing link-direction toggles
 * (default both on = prior undirected BFS, zero regression). Pure direction-aware
 * localSubgraph (graphPrefs), client-side, no getGraph change.
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); localStorage.removeItem("geode.graphPrefs"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r103", name: "r103", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeGraphLocal && !!window.__geodeGraphPrefs, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const gp = (raw) => app(([r]) => window.__geodeGraphPrefs(r), [raw]);
const lsPrefs = () => app(() => { try { return JSON.parse(localStorage.getItem("geode.graphPrefs")); } catch { return null; } });

// directed edges: a→b, b→c, x→a  (a: outgoing=b, incoming=x)
const EDGES = [{ source: "a", target: "b" }, { source: "b", target: "c" }, { source: "x", target: "a" }];
const local = (anchor, depth, dirs) =>
  app(([e, a, d, dd]) => window.__geodeGraphLocal(e, a, d, dd).sort(), [EDGES, anchor, depth, dirs]);

// ── localSubgraph direction + depth (probe) ─────────────────────────────────
console.log("— localSubgraph (probe) —");
ok("depth 1, both → anchor + outgoing(b) + incoming(x)", eq(await local("a", 1, { outgoing: true, incoming: true }), ["a", "b", "x"]), JSON.stringify(await local("a", 1, { outgoing: true, incoming: true })));
ok("depth 1, outgoing only → anchor + b", eq(await local("a", 1, { outgoing: true, incoming: false }), ["a", "b"]));
ok("depth 1, incoming only → anchor + x", eq(await local("a", 1, { outgoing: false, incoming: true }), ["a", "x"]));
ok("depth 2, outgoing only → a,b,c (transitive)", eq(await local("a", 2, { outgoing: true, incoming: false }), ["a", "b", "c"]));
ok("depth 1, outgoing only does NOT reach c", !(await local("a", 1, { outgoing: true, incoming: false })).includes("c"));
ok("both directions off → just the anchor", eq(await local("a", 1, { outgoing: false, incoming: false }), ["a"]));
ok("depth deeper than the graph is bounded (no infinite loop)", eq(await local("a", 5, { outgoing: true, incoming: true }), ["a", "b", "c", "x"]));

// ── prefs parse: depth 1–5 clamp + direction defaults + backward compat ─────
console.log("— prefs parse —");
ok("depth defaults 1", (await gp(null)).depth === 1);
ok("depth clamps 7 → 5", (await gp(JSON.stringify({ depth: 7 }))).depth === 5);
ok("depth clamps 0 → 1", (await gp(JSON.stringify({ depth: 0 }))).depth === 1);
ok("depth 3 preserved (new range)", (await gp(JSON.stringify({ depth: 3 }))).depth === 3);
ok("old blob depth 2 preserved (backward compat)", (await gp(JSON.stringify({ depth: 2 }))).depth === 2);
ok("non-numeric depth → default 1", (await gp(JSON.stringify({ depth: "x" }))).depth === 1);
ok("outgoing/incoming default true (zero regression)", (await gp(null)).outgoing === true && (await gp(null)).incoming === true);
ok("old blob without direction keys → both true", (await gp(JSON.stringify({ mode: "local" }))).outgoing === true);
ok("explicit outgoing:false parses", (await gp(JSON.stringify({ outgoing: false }))).outgoing === false);

// ── UI: local-mode depth select (1-5) + direction toggles persist ───────────
console.log("— local-mode UI + persistence —");
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 600)); });
await page.locator('[data-testid="graph-mode-local"]').click();
await wait(250);
ok("depth select offers 5 options (1–5)", (await app(() => document.querySelectorAll('[data-testid="graph-depth"] option').length)) === 5);
await page.locator('[data-testid="graph-settings-toggle"]').click();
await wait(200);
ok("Outgoing toggle present in local mode", await app(() => !!document.querySelector('[data-testid="graph-local-outgoing"]')));
ok("Incoming toggle present in local mode", await app(() => !!document.querySelector('[data-testid="graph-local-incoming"]')));
await page.click('[data-testid="graph-local-outgoing"]');
await wait(250);
ok("toggling Outgoing off persists outgoing:false", (await lsPrefs())?.outgoing === false);
await page.selectOption('[data-testid="graph-depth"]', "4");
await wait(250);
ok("changing depth to 4 persists depth:4", (await lsPrefs())?.depth === 4);

// ── direction toggles are local-mode only (hidden in global) ────────────────
console.log("— direction toggles hidden in global mode —");
await page.locator('[data-testid="graph-mode-global"]').click();
await wait(250);
ok("Outgoing/Incoming toggles hidden in global mode", await app(() => !document.querySelector('[data-testid="graph-local-outgoing"]') && !document.querySelector('[data-testid="graph-local-incoming"]')));
ok("depth select hidden in global mode", await app(() => !document.querySelector('[data-testid="graph-depth"]')));

console.log(`\nR103 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
