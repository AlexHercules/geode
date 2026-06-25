/**
 * R222 Tags-pane ↔ Obsidian native "Tags view" parity E2E — browser mode :1420.
 * Run: node .calibration/r222-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 222 additions".
 *
 * The independent TagsPanel already existed (R41/R69/R150/R151). R222 closes the three
 * native-fidelity gaps vs Obsidian's Tags view: (1) nested tree↔flat-list display toggle
 * (persisted), (2) Expand all / Collapse all bulk controls, (3) Cmd/Ctrl-click toggles the
 * tag within the current search term (accumulate filters) vs plain click (replace).
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
await page.evaluate(() => { try { localStorage.removeItem("geode.tagsDisplay"); localStorage.removeItem("geode.tagsSort"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r222", name: "r222", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// idempotent: only create the fixture tags if the vault doesn't already have them
// (a page reload wipes the in-memory vault, so this re-seeds after reload too)
const ensureTags = () => app(async () => {
  if (!window.__app.metadata.getTagMap().has("nest/alpha")) {
    await window.__app.vault.create("t1.md", "---\ntags: [nest/alpha, nest/beta, solo]\n---\n# x\n");
    await window.__app.vault.create("t2.md", "---\ntags: [nest/alpha]\n---\n# x\n");
  }
});

// nest/alpha=2, nest/beta=1, solo=1 ; nest = phantom parent (distinct notes = 2)
await ensureTags();
await page.waitForFunction(() => window.__app.metadata.getTagMap().has("nest/alpha"), null, { timeout: 4000 });

await app(() => window.__app.workspace.setRightPanel("tags"));
await page.waitForSelector("[data-testid=tags-panel]", { timeout: 4000 });
await wait(100);

const has = (sel) => app((s) => !!document.querySelector(s), sel);
const vis = (sel) => page.isVisible(sel);
const searchVal = () => app(() => document.querySelector("[data-testid=search-input]")?.value ?? "(no input)");

console.log("— default = TREE mode (nested hierarchy, R150 behavior preserved) —");
ok("phantom parent 'nest' renders as a tree node", await has("[data-testid='tag-row-nest']"));
ok("'nest' has a collapse chevron (it has children)", await has("[data-testid='tag-chevron-nest']"));
ok("child 'nest/alpha' visible (expanded by default)", await vis("[data-testid='tag-row-nest/alpha']"));
ok("display-toggle button exists", await has("[data-testid=tags-display-toggle]"));
ok("expand-all + collapse-all visible in tree mode", (await has("[data-testid=tags-expand-all]")) && (await has("[data-testid=tags-collapse-all]")));

console.log("— Collapse all / Expand all (tree mode) —");
await page.click("[data-testid=tags-collapse-all]");
await wait(80);
ok("after Collapse all, child 'nest/alpha' is hidden", !(await vis("[data-testid='tag-row-nest/alpha']")));
ok("the parent 'nest' is still visible", await vis("[data-testid='tag-row-nest']"));
await page.click("[data-testid=tags-expand-all]");
await wait(80);
ok("after Expand all, child 'nest/alpha' is visible again", await vis("[data-testid='tag-row-nest/alpha']"));

console.log("— display toggle → FLAT list (full paths, no phantom parents, no chevrons) —");
await page.click("[data-testid=tags-display-toggle]");
await wait(80);
ok("flat list container present", await has("[data-testid=tags-list-flat]"));
ok("flat: 'nest/alpha' shown by full path", await vis("[data-testid='tag-row-nest/alpha']"));
ok("flat: phantom 'nest' is NOT shown (only real tags)", !(await has("[data-testid='tag-row-nest']")));
ok("flat: no collapse chevron for 'nest'", !(await has("[data-testid='tag-chevron-nest']")));
ok("flat: expand/collapse-all controls are hidden (tree-only)", !(await has("[data-testid=tags-expand-all]")) && !(await has("[data-testid=tags-collapse-all]")));
const flatName = await app(() => document.querySelector("[data-testid='tag-row-nest/alpha'] .tag-row-name")?.textContent);
ok("flat row label is the FULL path 'nest/alpha' (not just 'alpha')", flatName === "nest/alpha", JSON.stringify(flatName));

console.log("— Cmd/Ctrl-click toggles the tag in the search term (accumulate); plain click replaces —");
// flat mode → all real-tag rows always visible (no collapse coupling); done BEFORE reload (vault populated)
await page.click("[data-testid='tag-row-solo']", { modifiers: ["Meta"] });
await page.waitForSelector("[data-testid=search-input]", { timeout: 4000 });
await wait(80);
ok("Cmd-click on empty query → 'tag:solo'", (await searchVal()) === "tag:solo", await searchVal());
await page.click("[data-testid='tag-row-nest/alpha']", { modifiers: ["Meta"] });
await wait(80);
ok("Cmd-click a 2nd tag accumulates → 'tag:solo tag:nest/alpha'", (await searchVal()) === "tag:solo tag:nest/alpha", await searchVal());
await page.click("[data-testid='tag-row-solo']", { modifiers: ["Meta"] });
await wait(80);
ok("Cmd-click an already-present tag REMOVES it (self-inverse) → 'tag:nest/alpha'", (await searchVal()) === "tag:nest/alpha", await searchVal());
// the StrictMode double-fire guard: a single toggle must not on→off-cancel itself
await page.click("[data-testid='tag-row-solo']", { modifiers: ["Meta"] });
await wait(80);
ok("single Cmd-click adds exactly once (no StrictMode double-toggle) → 'tag:nest/alpha tag:solo'", (await searchVal()) === "tag:nest/alpha tag:solo", await searchVal());
await page.click("[data-testid='tag-row-nest/alpha']"); // plain click
await wait(80);
ok("plain click REPLACES the query → '#nest/alpha' (tag browser mode)", (await searchVal()) === "#nest/alpha", await searchVal());

console.log("— display pref persists across reload (← restart acceptance line) —");
ok("pref written to localStorage (flat)", (await app(() => localStorage.getItem("geode.tagsDisplay"))) === "flat");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r222b", name: "r222b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await ensureTags(); // re-seed if the reload wiped the in-memory vault
await page.waitForFunction(() => window.__app.metadata.getTagMap().has("nest/alpha"), null, { timeout: 4000 });
await app(() => window.__app.workspace.setRightPanel("tags"));
await page.waitForSelector("[data-testid=tags-panel]", { timeout: 4000 });
await wait(100);
ok("after reload, display mode restores to flat", await has("[data-testid=tags-list-flat]"));
ok("after reload, tree chevrons are absent (flat, not tree)", !(await has("[data-testid='tag-chevron-nest']")));

console.log("— toggle back to tree mode works —");
await page.click("[data-testid=tags-display-toggle]");
await wait(80);
ok("after toggle, tree chevron for 'nest' returns", await has("[data-testid='tag-chevron-nest']"));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR222 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
