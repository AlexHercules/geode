/**
 * R152 reading-view #tag pill click → search E2E — browser mode :1420.
 * Run: node .calibration/r152-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 152 additions".
 *
 * Obsidian's reading view renders #tags as clickable pills that search the tag. Geode renders them
 * as <span class="tag-pill" data-tag="…"> (markdown.ts) — R152 adds a click delegation in
 * EditorPane.onPreviewClick (no markdown.ts change → no §C byte trigger) → workspace.requestSearch.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r152", name: "r152", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// a note with a simple tag + a nested tag, opened in reading (preview) mode
await app(() => window.__app.vault.create("r152target.md", "# target\n"));
// markdown.ts pillifies a #tag even inside link display text → `[#tag](note.md)` nests a pill
// in an <a.internal-link>; clicking it must NAVIGATE (link wins), not search (review F4 guard).
await app(() => window.__app.vault.create("r152.md", "# heading #r152htag\n\nbody #myr152tag and #r152proj/alpha here\n\nlink [#r152linktag](r152target.md) end\n"));
await app(async () => {
  window.__app.workspace.openFile("r152.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "preview");
});
await page.waitForSelector(".preview-content .tag-pill", { timeout: 4000 });
await wait(80);

console.log("— the reading view renders #tags as .tag-pill with data-tag —");
const pills = await app(() => [...document.querySelectorAll(".preview-content .tag-pill")].map((e) => e.getAttribute("data-tag")));
ok("a #myr152tag pill is rendered (data-tag='myr152tag')", pills.includes("myr152tag"), JSON.stringify(pills));
ok("a nested #r152proj/alpha pill is rendered (data-tag='r152proj/alpha')", pills.includes("r152proj/alpha"), JSON.stringify(pills));

console.log("— clicking a tag pill searches that tag —");
await app(() => window.__app.workspace.requestSearch("")); // reset to a clean non-search state
await app(() => window.__app.workspace.setLeftPanel("files"));
await wait(60);
await page.click(".preview-content .tag-pill[data-tag='myr152tag']");
await wait(150);
ok("click → left panel switches to search", (await app(() => window.__app.workspace.state.get().leftPanel)) === "search");
ok("click → the search input is seeded with '#myr152tag'", (await app(() => document.querySelector("[data-testid=search-input]")?.value)) === "#myr152tag");

console.log("— clicking a NESTED tag pill searches the full tag path —");
await app(() => window.__app.workspace.setLeftPanel("files"));
await wait(60);
await page.click(".preview-content .tag-pill[data-tag='r152proj/alpha']");
await wait(150);
ok("click nested pill → search seeded with the full '#r152proj/alpha'", (await app(() => document.querySelector("[data-testid=search-input]")?.value)) === "#r152proj/alpha");

console.log("— a #tag INSIDE a heading searches (tag wins over heading-fold) —");
await app(() => window.__app.workspace.setLeftPanel("files"));
await wait(60);
await page.click(".preview-content h1 .tag-pill[data-tag='r152htag']");
await wait(150);
ok("click a tag pill in a heading → search '#r152htag' (not heading fold)", (await app(() => document.querySelector("[data-testid=search-input]")?.value)) === "#r152htag");
ok("the heading was NOT folded by the tag click", await app(() => !document.querySelector(".preview-content h1")?.classList.contains("is-collapsed")));

console.log("— clicking non-pill heading TEXT still folds (heading branch intact) —");
await app(() => window.__app.workspace.setLeftPanel("files"));
await wait(60);
await page.click(".preview-content h1"); // the heading text, not a pill → fold, not search
await wait(120);
ok("clicking the heading text does not switch to search", (await app(() => window.__app.workspace.state.get().leftPanel)) === "files");
await page.click(".preview-content h1"); // unfold so the link section below is visible again
await wait(80);

console.log("— a #tag pill that IS link display text NAVIGATES the link, not search (review F4 guard) —");
ok("the pill nested in the link is rendered inside an <a>", await app(() => {
  const pill = document.querySelector(".preview-content .tag-pill[data-tag='r152linktag']");
  return !!pill && pill.closest("a") !== null;
}));
await app(() => window.__app.workspace.setLeftPanel("files"));
await wait(60);
await page.click(".preview-content .tag-pill[data-tag='r152linktag']");
await wait(200);
ok("clicking the pill-in-a-link does NOT switch to search (link nav wins)", (await app(() => window.__app.workspace.state.get().leftPanel)) !== "search");
ok("clicking the pill-in-a-link navigated to the linked note (r152target)", (await app(() => { const t = window.__app.workspace.getActiveTab(); return t && t.filePath; }))?.includes("r152target"));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR152 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
