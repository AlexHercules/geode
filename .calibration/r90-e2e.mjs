/**
 * R90 graph colour groups E2E — browser mode against dev :1420.
 * Run: node .calibration/r90-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 90 additions" (㊵ groups).
 *
 * Covers nodeGroupColor (via __geodeGraphGroupColor) — path:/text/first-match —
 * parseGraphPrefs groups backward-compat, and the settings Groups list (add /
 * edit / remove + persistence). Pure client-side colour, no .md writes.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r90", name: "r90", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeGraphGroupColor && !!window.__geodeGraphPrefs, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const gc = (node, groups, def) => app(([n, g, d]) => window.__geodeGraphGroupColor(n, g, d), [node, groups, def]);
const gp = (raw) => app(([r]) => window.__geodeGraphPrefs(r), [raw]);
const lsGroups = () => app(() => { try { return JSON.parse(localStorage.getItem("geode.graphPrefs"))?.groups; } catch { return null; } });

// ── nodeGroupColor truth table ──────────────────────────────────────────────
console.log("— nodeGroupColor —");
const node = { id: "Projects/Roadmap.md", label: "Roadmap" };
ok("no groups → default colour", (await gc(node, [], "#accent")) === "#accent");
ok("bare text matches the label (case-insensitive)", (await gc(node, [{ query: "road", color: "#ff0000" }], "#d")) === "#ff0000");
ok("path: matches the folder prefix", (await gc(node, [{ query: "path:Projects", color: "#00ff00" }], "#d")) === "#00ff00");
ok("no match → default", (await gc(node, [{ query: "path:Other", color: "#00ff00" }], "#d")) === "#d");
ok("first matching group wins", (await gc(node, [{ query: "road", color: "#111111" }, { query: "path:Projects", color: "#222222" }], "#d")) === "#111111");
ok("empty query is skipped", (await gc(node, [{ query: "  ", color: "#ff0000" }], "#d")) === "#d");
ok("path: of a non-matching folder doesn't false-match", (await gc({ id: "ProjectsX/a.md", label: "a" }, [{ query: "path:Projects", color: "#ff0000" }], "#d")) === "#d");

// ── parseGraphPrefs groups backward-compat ──────────────────────────────────
console.log("— parseGraphPrefs groups —");
ok("old blob (no groups) → []", JSON.stringify((await gp('{"mode":"local"}')).groups) === "[]");
const valid = await gp('{"groups":[{"query":"path:A","color":"#abcdef"}]}');
ok("valid group preserved", valid.groups.length === 1 && valid.groups[0].color === "#abcdef");
const bad = await gp('{"groups":[{"query":"x","color":"red"},{"query":"y","color":"#123456"},{"color":"#000000"}]}');
ok("invalid color / missing query dropped", bad.groups.length === 1 && bad.groups[0].query === "y", JSON.stringify(bad.groups));
const corrupt = await gp("}{nope");
ok("corrupt blob → groups default []", JSON.stringify(corrupt.groups) === "[]");

// ── settings Groups list (add / edit / remove + persistence) ────────────────
console.log("— settings Groups UI —");
await create("ga.md", "[[gb]]\n");
await create("gb.md", "hi\n");
await wait(200);
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 450)); });
await page.locator('[data-testid="graph-settings-toggle"]').click();
await wait(150);
ok("add-group button present", await app(() => !!document.querySelector('[data-testid="graph-group-add"]')));
await page.locator('[data-testid="graph-group-add"]').click();
await wait(120);
ok("a group row appears after add", await app(() => !!document.querySelector('[data-testid="graph-group-0"]')));
ok("new group persists to localStorage", (await lsGroups())?.length === 1);
// edit the query
await page.fill('[data-testid="graph-group-query-0"]', "path:Projects");
await wait(150);
ok("editing the query persists", (await lsGroups())?.[0]?.query === "path:Projects");
// add a second group, then remove the first
await page.locator('[data-testid="graph-group-add"]').click();
await wait(120);
ok("second group added", (await lsGroups())?.length === 2);
await page.locator('[data-testid="graph-group-remove-0"]').click();
await wait(150);
ok("removing a group persists (back to 1)", (await lsGroups())?.length === 1);

console.log(`\nR90 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
