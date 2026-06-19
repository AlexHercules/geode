/**
 * R110 graph local-mode "Neighbor links" toggle E2E — browser mode :1420.
 * Run: node .calibration/r110-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 110 additions" (㊵ 续).
 *
 * Neighbor links OFF (local mode) hides edges between two non-anchor neighbours — keep only
 * edges incident to the anchor (the "star"). Default ON = all interconnections (zero
 * regression). Pure edge filter = localEdges (graphPrefs), client-side, no getGraph change.
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
const eqSet = (a, b) => { const s = new Set(a.map((e) => `${e.source}>${e.target}`)); return b.length === a.length && b.every((e) => s.has(`${e.source}>${e.target}`)); };
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); localStorage.removeItem("geode.graphPrefs"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r110", name: "r110", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeLocalEdges && !!window.__geodeGraphPrefs, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const gp = (raw) => app(([r]) => window.__geodeGraphPrefs(r), [raw]);
const lsPrefs = () => app(() => { try { return JSON.parse(localStorage.getItem("geode.graphPrefs")); } catch { return null; } });
// anchor A; A↔B, A↔C (incident to anchor), B↔C (between two neighbours)
const EDGES = [{ source: "A", target: "B" }, { source: "A", target: "C" }, { source: "B", target: "C" }];
const KEPT = ["A", "B", "C"];
const le = (anchor, neighbor) => app(([e, k, a, n]) => window.__geodeLocalEdges(e, k, a, n), [EDGES, KEPT, anchor, neighbor]);

// ── localEdges (probe) ──────────────────────────────────────────────────────
console.log("— localEdges (probe) —");
ok("neighbor ON → all 3 edges kept (zero regression)", eqSet(await le("A", true), EDGES), JSON.stringify(await le("A", true)));
ok("neighbor OFF → only the 2 anchor-incident edges (B↔C dropped)", eqSet(await le("A", false), [{ source: "A", target: "B" }, { source: "A", target: "C" }]), JSON.stringify(await le("A", false)));
ok("neighbor OFF, anchor null (global mode) → all edges (no filter)", eqSet(await le(null, false), EDGES));
ok("neighbor OFF drops EXACTLY the between-neighbour edge", !(await le("A", false)).some((e) => (e.source === "B" && e.target === "C")));

// ── prefs parse: neighborLinks default ON + backward compat ─────────────────
console.log("— prefs parse —");
ok("neighborLinks defaults true (zero regression)", (await gp(null)).neighborLinks === true);
ok("old blob without neighborLinks → true (backward compat)", (await gp(JSON.stringify({ mode: "local" }))).neighborLinks === true);
ok("explicit neighborLinks:false parses", (await gp(JSON.stringify({ neighborLinks: false }))).neighborLinks === false);

// ── UI: the toggle exists in local mode, persists, hidden in global ─────────
console.log("— local-mode UI + persistence —");
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 600)); });
await page.locator('[data-testid="graph-mode-local"]').click();
await wait(200);
await page.locator('[data-testid="graph-settings-toggle"]').click();
await wait(200);
ok("Neighbor-links toggle present in local mode", await app(() => !!document.querySelector('[data-testid="graph-local-neighbor"]')));
await page.click('[data-testid="graph-local-neighbor"]');
await wait(250);
ok("toggling Neighbor links off persists neighborLinks:false", (await lsPrefs())?.neighborLinks === false);
await page.locator('[data-testid="graph-mode-global"]').click();
await wait(250);
ok("Neighbor-links toggle hidden in global mode", await app(() => !document.querySelector('[data-testid="graph-local-neighbor"]')));

console.log(`\nR110 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
