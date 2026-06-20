/**
 * R41 tags pane + editor `#` tag completion E2E — browser mode vs dev :1420.
 * Run: node .calibration/r41-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 41 additions".
 *
 *  A. pure `#` completion (window.__geodeTag): trigger gate + candidate ranking.
 *  B. Tags pane: renders all tags + counts (count desc), click → requestSearch.
 *  C. live editor: type `#al` → completion popup → Enter inserts `#alpha`.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r41", name: "r41", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeTag, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FILES = {
  "r41/a.md": "# A\n\n#alpha #beta\n",
  "r41/b.md": "# B\n\n#alpha #gamma\n",
  "r41/c.md": "# C\n\n#alpha/sub\n",
};
for (const [p, c] of Object.entries(FILES)) {
  await app(async ([path, content]) => { try { await window.__app.vault.create(path, content); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 30)); }, [p, c]);
}
await page.waitForFunction(() => {
  const m = window.__app.metadata.getTagMap();
  return m.has("alpha") && (m.get("alpha")?.size ?? 0) >= 2 && m.has("alpha/sub");
}, null, { timeout: 6000 });

// ── A. pure `#` completion (__geodeTag) ──────────────────────────────────────
console.log("A. pure `#` completion (window.__geodeTag)");
const trig = (before) => app((b) => window.__geodeTag.trigger(b), before);
const cand = (q) => app((query) => window.__geodeTag.candidates(query), q);
ok("trigger '#al' → query 'al'", JSON.stringify(await trig("#al")) === JSON.stringify({ query: "al" }));
ok("trigger 'text #be' → query 'be'", (await trig("text #be"))?.query === "be");
ok("trigger '#' → query '' (browse all)", (await trig("#"))?.query === "");
ok("trigger '## ' (heading) → null", (await trig("## ")) === null);
ok("trigger '# ' (heading) → null", (await trig("# ")) === null);
ok("trigger 'plain text' → null", (await trig("plain text")) === null);
ok("trigger inside '[[link #x' → null (wikilink owns it)", (await trig("[[link #x")) === null);
ok("trigger '(#al' → query 'al' (after paren, matches metadata gate)", (await trig("(#al"))?.query === "al");
const cAll = await cand("");
// NOTE: the seeded MemoryVault has its own tags too, so assert sorted + superset
const cAllSorted = cAll.every((t, i) => i === 0 || cAll[i - 1].localeCompare(t) <= 0);
ok("candidates('') sorted alpha + includes my tags", cAllSorted && ["alpha", "alpha/sub", "beta", "gamma"].every((t) => cAll.includes(t)), JSON.stringify(cAll));
const cAl = await cand("al");
ok("candidates('al') → alpha + alpha/sub", cAl.includes("alpha") && cAl.includes("alpha/sub") && !cAl.includes("beta"), JSON.stringify(cAl));
ok("candidates('gam') → gamma", JSON.stringify(await cand("gam")) === JSON.stringify(["gamma"]));

// degenerate frontmatter tags (R41 review fix): empty / whitespace tokens dropped
await app(async () => {
  try { await window.__app.vault.create("r41/fm.md", '---\ntags: ["#", "bad space", "goodfm"]\n---\n'); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 60));
});
await page.waitForFunction(() => window.__app.metadata.getTagMap().has("goodfm"), null, { timeout: 4000 });
const tagKeys = await app(() => [...window.__app.metadata.getTagMap().keys()]);
ok("frontmatter valid tag 'goodfm' indexed", tagKeys.includes("goodfm"), JSON.stringify(tagKeys));
ok("frontmatter junk tags ('' / 'bad space') NOT indexed", !tagKeys.includes("") && !tagKeys.includes("bad space"), JSON.stringify(tagKeys));

// ── B. Tags pane (right sidebar) ─────────────────────────────────────────────
console.log("B. Tags pane (render + count + click→search)");
await app(() => window.__app.workspace.setRightPanel("tags"));
await page.waitForSelector("[data-testid=tags-panel]", { timeout: 4000 });
await wait(80);
// R150: the tags pane now renders a nested TREE — #alpha/sub is a CHILD of #alpha showing the
// leaf segment "sub" (full path stays in the data-testid). Tree specifics are covered by r150-e2e.
const node = (full) => app(([f]) => {
  const el = document.querySelector(`[data-testid='tag-row-${f}']`);
  return el ? { name: el.querySelector(".tag-row-name")?.textContent, count: el.querySelector(".tag-row-count")?.textContent } : null;
}, [full]);
ok("tags pane lists my tags (alpha/beta/gamma top-level + alpha/sub nested)",
  !!((await node("alpha")) && (await node("beta")) && (await node("gamma")) && (await node("alpha/sub"))));
ok("#alpha shows its exact count 2", (await node("alpha"))?.count === "2");
ok("nested tag #alpha/sub renders under #alpha as leaf 'sub'", (await node("alpha/sub"))?.name === "sub");
// click #alpha → requestSearch → left search panel seeded
await page.click("[data-testid=tags-panel] [data-testid='tag-row-alpha']");
await wait(120);
ok("click tag → left panel switches to search", (await app(() => window.__app.workspace.state.get().leftPanel)) === "search");
ok("click tag → searchRequest consumed (null)", (await app(() => window.__app.workspace.searchRequest.get())) === null);
const searchInputVal = await app(() => document.querySelector(".search-input,[data-testid=search-input],.palette-input")?.value ?? null);
ok("search input seeded with '#alpha'", searchInputVal === "#alpha", JSON.stringify(searchInputVal));

// ── C. live editor `#` completion ────────────────────────────────────────────
console.log("C. live editor `#` completion (type → popup → Enter inserts #alpha)");
const SCRATCH = "r41/scratch.md";
await app(async (p) => { try { await window.__app.vault.create(p, ""); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, SCRATCH);
await app(async (p) => {
  window.__app.workspace.openFile(p);
  window.__app.workspace.setTabMode(window.__app.workspace.getActiveTab().id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, SCRATCH);
await page.waitForSelector(".cm-content", { timeout: 4000 });
const getDoc = () => app((p) => window.__app.documents.get(p)?.getText() ?? "", SCRATCH);
await page.click(".cm-content");
await page.keyboard.type("#al", { delay: 40 });
await page.waitForSelector(".cm-tooltip-autocomplete", { timeout: 3000 }).catch(() => {});
await wait(120);
const popupOpen = await app(() => !!document.querySelector(".cm-tooltip-autocomplete"));
ok("typing '#al' opens the completion popup", popupOpen === true);
await page.keyboard.press("Enter");
await wait(100);
ok("Enter inserts a full tag (#alpha)", (await getDoc()).trim() === "#alpha", JSON.stringify(await getDoc()));

console.log(`\nR41 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
