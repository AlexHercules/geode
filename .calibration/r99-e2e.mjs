/**
 * R99 tags-as-graph-nodes E2E — browser mode :1420.
 * Run: node .calibration/r99-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 99 additions" (㊵ 续续续).
 *
 * A "Tags" toggle merges tag nodes (id `tag:<name>`, green) + note→tag edges into the
 * graph, client-side (buildTagGraph), no getGraph/index change. Default OFF (zero
 * regression). Pure front-end, no .md writes.
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
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); localStorage.removeItem("geode.graphPrefs"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r99", name: "r99", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeGraphTags && !!window.__geodeGraphPrefs, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const lsPrefs = () => app(() => { try { return JSON.parse(localStorage.getItem("geode.graphPrefs")); } catch { return null; } });
const gp = (raw) => app(([r]) => window.__geodeGraphPrefs(r), [raw]);
const legendNodes = () => app(() => {
  const el = document.querySelector('[data-testid="graph-legend"]');
  if (!el) return null;
  const m = el.textContent.match(/(\d[\d,]*)/);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
});

// ── tag-graph construction (probe) ──────────────────────────────────────────
console.log("— buildTagGraph (probe) —");
await create("n1.md", "#alpha #beta\n\n[[n2]] body\n");
await create("n2.md", "#alpha\n\nbody\n");
await create("n3.md", "no tags here\n");
await wait(350);
// NOTE: the dev-server vault has pre-existing seed notes/tags, so assert on OUR tags
// (#alpha/#beta) by degree, not on absolute totals.
const tg = await app(() => window.__geodeGraphTags());
const deg = (id) => tg.nodes.find((n) => n.id === id)?.degree;
ok("tag node #alpha has degree 2 (n1 + n2 use it)", deg("tag:alpha") === 2, JSON.stringify(tg.nodes));
ok("tag node #beta has degree 1 (only n1 uses it)", deg("tag:beta") === 1, JSON.stringify(tg.nodes));
ok("no spurious tag node for the untagged note", !tg.nodes.some((n) => n.id.includes("n3")), JSON.stringify(tg.nodes));

// ── prefs: showTags default OFF + backward compat ───────────────────────────
console.log("— prefs parse —");
ok("display.tags defaults false (zero regression)", (await gp(null)).display.tags === false);
ok("old blob without 'tags' → false (backward compat)", (await gp(JSON.stringify({ mode: "global" }))).display.tags === false);
ok("explicit tags:true parses", (await gp(JSON.stringify({ display: { tags: true } }))).display.tags === true);

// ── toggle UI + persistence + legend node count ─────────────────────────────
console.log("— Tags toggle (real graph) —");
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 600)); });
await page.locator('[data-testid="graph-settings-toggle"]').click();
await wait(200);
ok("Tags toggle present in graph settings", await app(() => !!document.querySelector('[data-testid="graph-tags"]')));
const before = await legendNodes();
ok("legend shows the note nodes before tags are on", before !== null && before >= 3, JSON.stringify(before));
await page.click('[data-testid="graph-tags"]');
await wait(400); // rebuild + settle
ok("toggling Tags on persists display.tags:true", (await lsPrefs())?.display?.tags === true);
const after = await legendNodes();
// the legend grows by exactly the number of tag nodes buildTagGraph produced
ok("legend node count grows by the tag-node count", after === before + tg.nodes.length, `before=${before} after=${after} tags=${tg.nodes.length}`);

// ── clicking a tag node SEARCHES it, never opens a broken "tag:" file tab (review MAJOR) ──
console.log("— tag-node click routing (review MAJOR) —");
const noTagTab = () => app(() => {
  const tabs = [];
  const walk = (node) => ("tabs" in node ? node.tabs.forEach((t) => tabs.push(t)) : node.children.forEach(walk));
  walk(window.__app.workspace.state.get().root);
  return !tabs.some((t) => (t.filePath ?? "").startsWith("tag:"));
});
const clicked = await app(() => window.__geodeGraphClickNode("tag:alpha"));
await wait(200);
ok("the click hook found the tag node (tags are on)", clicked === true);
ok("clicking a tag node opens the search panel (Obsidian-aligned)", (await app(() => window.__app.workspace.state.get().leftPanel)) === "search");
ok("clicking a tag node creates NO broken 'tag:' file tab", await noTagTab());
await app(() => window.__geodeGraphClickNode("n1.md"));
await wait(200);
ok("clicking a NOTE node still opens that file", (await app(() => window.__app.workspace.getActiveTab()?.filePath)) === "n1.md");
// re-open the graph for the toggle-off check (the note click switched the active tab)
await app(async () => { window.__app.workspace.openGraph(); await new Promise((r) => setTimeout(r, 400)); });
await page.locator('[data-testid="graph-settings-toggle"]').click();
await wait(150);

await page.click('[data-testid="graph-tags"]');
await wait(400);
ok("toggling Tags off persists display.tags:false", (await lsPrefs())?.display?.tags === false);
ok("legend node count returns to the note-only count", (await legendNodes()) === before, JSON.stringify(await legendNodes()));

console.log(`\nR99 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
