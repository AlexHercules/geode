/**
 * R150 tags-pane nested hierarchy tree + collapse E2E — browser mode :1420.
 * Run: node .calibration/r150-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 150 additions".
 *
 * Obsidian's tag pane shows nested tags (#a/b) as a collapsible tree (leaf segment shown, chevron to
 * fold). R150 builds that tree from getTagMap. Counts: real tags = exact note count; phantom parents
 * (a path segment never used as a tag itself) = subtree distinct-note aggregate.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r150", name: "r150", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// seed nested tags via frontmatter:
//   A: #r150top, #r150top/child     B: #r150top/child, #r150top/child/leaf     C: #r150ph/only
// → exact counts: r150top=1, r150top/child=2, r150top/child/leaf=1, r150ph/only=1
// → phantom parent r150ph (never a tag itself) → aggregate distinct = {C} = 1
const mk = (p, tags) => app(([path, tg]) => window.__app.vault.create(path, `---\ntags: [${tg}]\n---\n# x\n`), [p, tags.join(", ")]);
await mk("r150a.md", ["r150top", "r150top/child"]);
await mk("r150b.md", ["r150top/child", "r150top/child/leaf"]);
await mk("r150c.md", ["r150ph/only"]);
// malformed tags (leading / trailing / double slash) — must not make empty-named rows or collide
await mk("r150mal.md", ['"r150mal/"', '"/r150mal2"']);
// sibling sort: #r150sort/hi on 2 notes, #r150sort/lo on 1 → hi must sort before lo (count desc)
await mk("r150s1.md", ["r150sort/hi", "r150sort/lo"]);
await mk("r150s2.md", ["r150sort/hi"]);
await page.waitForFunction(() => window.__app.metadata.getTagMap().has("r150sort/hi"), null, { timeout: 4000 });

await app(() => window.__app.workspace.setRightPanel("tags"));
await page.waitForSelector("[data-testid=tags-panel]", { timeout: 4000 });
await wait(100);

const nodeText = (full) => app(([f]) => {
  const el = document.querySelector(`[data-testid='tag-row-${f}']`);
  if (!el) return null;
  return { name: el.querySelector(".tag-row-name")?.textContent, count: el.querySelector(".tag-row-count")?.textContent };
}, [full]);
const hasChevron = (full) => app(([f]) => !!document.querySelector(`[data-testid='tag-chevron-${f}']`), [full]);
const visible = (full) => page.isVisible(`[data-testid='tag-row-${full}']`);

console.log("— nested tags render as a tree (leaf segment shown, full path in testid) —");
ok("#r150top is a top-level node named 'r150top' with its EXACT count (1)", JSON.stringify(await nodeText("r150top")) === JSON.stringify({ name: "r150top", count: "1" }));
ok("#r150top/child shows the leaf segment 'child', count 2", JSON.stringify(await nodeText("r150top/child")) === JSON.stringify({ name: "child", count: "2" }));
ok("#r150top/child/leaf shows leaf 'leaf', count 1", JSON.stringify(await nodeText("r150top/child/leaf")) === JSON.stringify({ name: "leaf", count: "1" }));

console.log("— parents have a chevron; leaves do not —");
ok("#r150top (has children) shows a chevron", (await hasChevron("r150top")) === true);
ok("#r150top/child (has a child) shows a chevron", (await hasChevron("r150top/child")) === true);
ok("#r150top/child/leaf (no children) has NO chevron", (await hasChevron("r150top/child/leaf")) === false);

console.log("— a phantom parent (segment never used as a tag) appears with a subtree aggregate count —");
ok("#r150ph is shown as a phantom parent named 'r150ph'", (await nodeText("r150ph"))?.name === "r150ph");
ok("#r150ph aggregate count = 1 (distinct notes in subtree)", (await nodeText("r150ph"))?.count === "1");
ok("#r150ph has a chevron (it has a child)", (await hasChevron("r150ph")) === true);
ok("#r150ph/only is its child named 'only'", (await nodeText("r150ph/only"))?.name === "only");

console.log("— collapsing a node hides its descendants; expanding shows them —");
ok("before collapse: #r150top/child is visible", (await visible("r150top/child")) === true);
await page.click("[data-testid='tag-chevron-r150top']");
await wait(60);
ok("after collapsing #r150top: its child #r150top/child is hidden", (await visible("r150top/child")) === false);
ok("the collapsed parent #r150top itself stays visible", (await visible("r150top")) === true);
await page.click("[data-testid='tag-chevron-r150top']");
await wait(60);
ok("after expanding #r150top: its child is visible again", (await visible("r150top/child")) === true);

console.log("— siblings sort by count desc (R150 review: sort coverage) —");
const siblingOrder = await app(() => {
  const rows = [...document.querySelectorAll("[data-testid^='tag-row-r150sort/']")].map(
    (e) => e.getAttribute("data-testid"),
  );
  return rows;
});
ok("under #r150sort: hi (count 2) sorts before lo (count 1)",
  siblingOrder.indexOf("tag-row-r150sort/hi") < siblingOrder.indexOf("tag-row-r150sort/lo") &&
    siblingOrder.indexOf("tag-row-r150sort/hi") >= 0, JSON.stringify(siblingOrder));

console.log("— malformed tags (slashes) make no empty-named rows and don't collide —");
const emptyNamed = await app(() => [...document.querySelectorAll(".tags-panel .tag-row-name")].filter((e) => e.textContent === "").length);
ok("no tag-row has an empty name (malformed segments skipped)", emptyNamed === 0, `emptyNamed=${emptyNamed}`);
ok("#r150mal/ (trailing slash) renders cleaned as 'r150mal'", (await nodeText("r150mal"))?.name === "r150mal");
ok("#/r150mal2 (leading slash) renders cleaned as 'r150mal2' (no leading-slash collision)", (await nodeText("r150mal2"))?.name === "r150mal2");

console.log("— clicking a (parent) tag searches its full path —");
await page.click("[data-testid='tag-row-r150top']");
await wait(120);
ok("click #r150top → left panel = search", (await app(() => window.__app.workspace.state.get().leftPanel)) === "search");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR150 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
