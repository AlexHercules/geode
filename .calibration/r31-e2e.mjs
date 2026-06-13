/**
 * R31 slash-command `/` menu E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r31-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 31 additions".
 *
 * Covers:
 *  1. trigger probe (__geodeSlash.trigger): `/` at line-start / after whitespace
 *     fires; mid-word (`and/or`), `http://`, `[[a/b` do NOT.
 *  2. candidate probe (__geodeSlash.candidates): available commands fuzzy-ranked;
 *     unavailable commands excluded.
 *  3. real CM editor apply flow: type `/` → .cm-tooltip-autocomplete opens →
 *     filter → Enter runs the command AND deletes the `/query` text.
 *  4. gating in the real editor: `/` mid-word does not open the menu.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r31", name: "r31", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeSlash, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// register a probe command that inserts a marker at the cursor (so we can verify
// it ran AND the /query was deleted)
await app(() => {
  window.__r31ran = 0;
  window.__app.commands.register({
    id: "r31:zzmarker",
    name: "ZZ Insert Marker",
    callback: () => {
      window.__r31ran++;
      const view = window.__app.documents.getActiveView?.()?.view;
      if (view) {
        const pos = view.state.selection.main.head;
        view.dispatch({ changes: { from: pos, insert: "★" }, selection: { anchor: pos + 1 } });
      }
    },
  });
  // an UNAVAILABLE command must never appear in the slash menu
  window.__app.commands.register({
    id: "r31:hidden",
    name: "ZZ Hidden Never",
    available: () => false,
    callback: () => { window.__r31ran += 100; },
  });
});

// ── 1. trigger probe (gating) ────────────────────────────────────────────────
console.log("— trigger probe (gating) —");
const trig = (s) => app((b) => window.__geodeSlash.trigger(b), s);
ok("`/` at line start triggers", JSON.stringify(await trig("/")) === JSON.stringify({ query: "" }));
ok("`/qu` after text+space triggers with query", JSON.stringify(await trig("hello /qu")) === JSON.stringify({ query: "qu" }));
ok("mid-word `and/or` does NOT trigger", (await trig("and/or")) === null);
ok("`http://` does NOT trigger", (await trig("see http://")) === null);
ok("`[[a/b` does NOT trigger", (await trig("[[a/b")) === null);
ok("hyphenated query allowed", JSON.stringify(await trig("/insert-da")) === JSON.stringify({ query: "insert-da" }));

// ── 2. candidate probe (ranking + availability) ──────────────────────────────
console.log("— candidate probe —");
const cand = (q) => app((query) => window.__geodeSlash.candidates(query), q);
const allCands = await cand("");
ok("empty query lists commands", Array.isArray(allCands) && allCands.length > 0, String(allCands?.length));
ok("empty query INCLUDES our available probe command", allCands.includes("r31:zzmarker"));
ok("empty query EXCLUDES the unavailable command", !allCands.includes("r31:hidden"));
const zzCands = await cand("zzmarker");
ok("fuzzy query 'zzmarker' ranks our command first", zzCands[0] === "r31:zzmarker", JSON.stringify(zzCands.slice(0, 3)));
const noCands = await cand("zzzznevermatchzzzz");
ok("non-matching query → empty candidate list", Array.isArray(noCands) && noCands.length === 0);

// ── 3. real CM editor apply flow ─────────────────────────────────────────────
console.log("— real CM editor apply flow —");
await create("r31/scratch.md", "start\n");
await app(async () => {
  window.__app.workspace.openFile("r31/scratch.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
// move to end of the document, then type a slash query on a fresh segment
await page.keyboard.press("Control+End");
await page.keyboard.type(" /zzmarker");
await wait(250);
ok("typing `/zzmarker` opens the autocomplete tooltip", await page.isVisible(".cm-tooltip-autocomplete"));
const firstOpt = await page.textContent(".cm-tooltip-autocomplete li");
ok("top option is our command", typeof firstOpt === "string" && firstOpt.includes("ZZ Insert Marker"), firstOpt);
await page.keyboard.press("Enter");
await wait(200);
const ran = await app(() => window.__r31ran);
ok("Enter ran the command exactly once", ran === 1, String(ran));
const docText = await app(() => window.__app.documents.get("r31/scratch.md")?.getText() ?? "");
ok("`/zzmarker` text was deleted (no leftover slash query)", !docText.includes("/zzmarker"), JSON.stringify(docText));
ok("command effect landed (marker ★ inserted)", docText.includes("★"), JSON.stringify(docText));

// ── 4. live filtering as you type (CRITICAL regression: filter:false+validFor
//      froze the list — must re-query/narrow on each keystroke) ───────────────
console.log("— live filtering (incremental) —");
const liOpts = () => page.$$eval(".cm-tooltip-autocomplete li", (els) => els.map((e) => e.textContent));
await page.keyboard.press("Control+End");
await page.keyboard.type(" /", { delay: 40 });
await wait(160);
const atSlash = await liOpts().catch(() => []);
// type a discriminating query slowly (per-key delay > CM debounce) so a frozen
// list would be caught
await page.keyboard.type("zzmarker", { delay: 60 });
await wait(180);
const atQuery = await liOpts().catch(() => []);
ok("menu narrows as you type (list changed from the `/`-time list)",
  JSON.stringify(atSlash) !== JSON.stringify(atQuery) && atSlash.length > 0, `${atSlash.length}→${atQuery.length}`);
ok("narrowed top option is the matching command", atQuery[0]?.includes("ZZ Insert Marker"), JSON.stringify(atQuery.slice(0, 3)));
await page.keyboard.press("Escape");
await wait(80);

// ── 5. gating in the real editor: `/` mid-word + inside open wikilink ─────────
console.log("— real editor gating —");
await page.keyboard.press("Control+End");
await page.keyboard.type("word/x");
await wait(200);
ok("mid-word `/` does NOT open the menu", !(await page.isVisible(".cm-tooltip-autocomplete")));
// MAJOR regression: slash must not co-fire inside an open [[ wikilink
await page.keyboard.press("Control+End");
await page.keyboard.type("\n[[foo /zzmarker", { delay: 30 });
await wait(200);
const inWiki = await liOpts().catch(() => []);
ok("slash menu suppressed inside an open [[ wikilink", !inWiki.some((t) => t?.includes("ZZ Insert Marker")), JSON.stringify(inWiki.slice(0, 3)));
ok("trigger probe: `[[foo /ne` suppressed", (await app(() => window.__geodeSlash.trigger("[[foo /ne"))) === null);

console.log(`\nR31 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
