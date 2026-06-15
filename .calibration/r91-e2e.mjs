/**
 * R91 Explorer file-tree sort E2E — browser mode :1420.
 * Run: node .calibration/r91-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 91 additions" (㊽ sort).
 *
 * Covers sortTreeNodes (folders-first + name asc/desc, numeric, via __geodeSortTree)
 * + the explorer toolbar sort toggle re-ordering the tree + persistence.
 * Presentation-only — no .md writes besides the seed files.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r91", name: "r91", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeSortTree, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const sort = (nodes, key) => app(([n, k]) => window.__geodeSortTree(n, k), [nodes, key]);
const ls = (k) => app(([key]) => localStorage.getItem(key), [k]);
// the data-path of each rendered root-level file row (folders excluded)
const rootFileRows = () => app(() =>
  [...document.querySelectorAll('[data-testid="explorer"] [data-testid="explorer-item"]')]
    .map((el) => el.getAttribute("data-path"))
    .filter((p) => p && p.endsWith(".md") && !p.includes("/")));

// ── sortTreeNodes truth table ───────────────────────────────────────────────
console.log("— sortTreeNodes —");
const mixed = [
  { kind: "file", name: "banana.md" },
  { kind: "folder", name: "Zebra" },
  { kind: "file", name: "apple.md" },
  { kind: "folder", name: "alpha" },
];
ok("name-asc → folders first (alpha, Zebra), then files (apple, banana)",
  JSON.stringify(await sort(mixed, "name-asc")) === '["alpha","Zebra","apple.md","banana.md"]');
ok("name-desc → folders first reversed (Zebra, alpha), files reversed (banana, apple)",
  JSON.stringify(await sort(mixed, "name-desc")) === '["Zebra","alpha","banana.md","apple.md"]');
const nums = [{ kind: "file", name: "n10.md" }, { kind: "file", name: "n2.md" }, { kind: "file", name: "n1.md" }];
ok("numeric natural order (n1, n2, n10 not n1, n10, n2)", JSON.stringify(await sort(nums, "name-asc")) === '["n1.md","n2.md","n10.md"]');
const caseMix = [{ kind: "file", name: "Beta.md" }, { kind: "file", name: "alpha.md" }];
ok("case-insensitive (alpha before Beta)", JSON.stringify(await sort(caseMix, "name-asc")) === '["alpha.md","Beta.md"]');

// ── explorer toolbar toggle re-orders the tree ──────────────────────────────
console.log("— explorer sort toggle —");
await create("r91-a.md", "a\n");
await create("r91-b.md", "b\n");
await create("r91-c.md", "c\n");
await wait(250);
ok("sort toggle button present", await app(() => !!document.querySelector('[data-testid="explorer-sort-toggle"]')));
const asc = await rootFileRows();
ok("default order is name ascending (a, b, c)",
  asc.indexOf("r91-a.md") < asc.indexOf("r91-b.md") && asc.indexOf("r91-b.md") < asc.indexOf("r91-c.md"), JSON.stringify(asc));
// toggle → descending
await page.click('[data-testid="explorer-sort-toggle"]');
await wait(150);
ok("toggle persists name-desc to localStorage", (await ls("geode.explorerSort")) === "name-desc");
const desc = await rootFileRows();
ok("tree re-orders to descending (c, b, a)",
  desc.indexOf("r91-c.md") < desc.indexOf("r91-b.md") && desc.indexOf("r91-b.md") < desc.indexOf("r91-a.md"), JSON.stringify(desc));
// toggle back → ascending, persists empty (default)
await page.click('[data-testid="explorer-sort-toggle"]');
await wait(150);
ok("toggling back restores ascending order",
  (await (async () => { const r = await rootFileRows(); return r.indexOf("r91-a.md") < r.indexOf("r91-c.md"); })()));
ok("name-asc default persists as removed key (null)", (await ls("geode.explorerSort")) === null);

console.log(`\nR91 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
