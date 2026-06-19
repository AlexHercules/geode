/**
 * R109 wikilink [[note#^ block-reference completion E2E — browser mode :1420.
 * Run: node .calibration/r109-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 109 additions" (㊹ 续).
 *
 * `[[<note>#^<query>` completes the resolved note's block references — the LABEL is the block
 * TEXT (Geode mints opaque ids, so you pick by content), the inserted text is the id →
 * `[[note#^id]]`. Async (reads the note for the preview). Pure resolver = wikilinkBlockTargets.
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
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r109", name: "r109", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeBlockComplete, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bc = (typed, fromPath) => app(([t, f]) => window.__geodeBlockComplete(t, f), [typed, fromPath]);

// a note with two block-id-marked paragraphs + a heading (to prove #^ vs # routing)
await app(async () => {
  try { await window.__app.vault.create("ZZBlk.md", "# Heading One\n\nThe quick brown fox ^blkfox\n\nLazy dog sleeps ^blkdog\n"); } catch { /* exists */ }
  try { await window.__app.vault.create("ZZSrc.md", "# Src\n"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 250));
});

// ── wikilinkBlockTargets (probe, async) ─────────────────────────────────────
console.log("— wikilinkBlockTargets (probe) —");
const blocks = await bc("ZZBlk#^", "ZZSrc.md");
const byId = (id) => (blocks ?? []).find((b) => b.id === id);
ok("`[[ZZBlk#^` → the note's blocks with id + text preview", Array.isArray(blocks) && blocks.length === 2, JSON.stringify(blocks));
ok("block preview strips the `^id` marker (text = the paragraph)", byId("blkfox")?.text === "The quick brown fox" && byId("blkdog")?.text === "Lazy dog sleeps", JSON.stringify(blocks));
ok("`[[#^` (self-link) → the CURRENT note's blocks", (await (async () => { const b = await bc("#^", "ZZBlk.md"); return Array.isArray(b) && b.length === 2; })()));
ok("`[[ZZBlk#` (heading, no caret) → null (heading branch, not block)", (await bc("ZZBlk#", "ZZSrc.md")) === null);
ok("`[[ZZSrc#^` (note has no blocks) → null", (await bc("ZZSrc#^", "ZZSrc.md")) === null);
ok("`[[Nonexistent#^` (unresolvable) → null", (await bc("Nonexistent#^", "ZZSrc.md")) === null);

// ── [[note#^ CM completion: pick by content → insert [[note#^id]] ───────────
console.log("— [[note#^ CM completion —");
await app(async () => {
  window.__app.workspace.openFile("ZZSrc.md");
  await new Promise((r) => setTimeout(r, 200));
  const tab = window.__app.workspace.getActiveTab();
  if (tab) window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n[[ZZBlk#^");
await wait(500); // async read + popup
ok("typing `[[ZZBlk#^` opens the autocomplete tooltip", await page.isVisible(".cm-tooltip-autocomplete"));
const opts = await page.$$eval(".cm-tooltip-autocomplete li", (els) => els.map((e) => e.textContent)).catch(() => []);
ok("the block TEXT previews are shown (pick by content, not opaque id)", opts.some((o) => o && o.includes("quick brown fox")), JSON.stringify(opts));
// filter by content then accept
await page.keyboard.type("quick");
await wait(300);
await page.keyboard.press("Enter");
await wait(250);
const docText = await app(() => window.__app.documents.get(window.__app.workspace.getActiveFile())?.getText() ?? "");
ok("picking a block inserts `[[ZZBlk#^blkfox]]` (the id, filtered by content)", docText.includes("[[ZZBlk#^blkfox]]"), JSON.stringify(docText.slice(-40)));
ok("the inserted block link resolves (subpath span found)", await app(() => {
  // resolveSubpath finds the ^blk span — confirm via the metadata block index
  const blocks = window.__app.metadata.getMetadata("ZZBlk.md")?.blocks ?? [];
  return blocks.some((b) => b.id === "blkfox");
}));

// ── zero regression: [[note# heading completion still works (not block) ─────
console.log("— zero regression: heading + file completion —");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n[[ZZBlk#");
await wait(350);
const headOpts = await page.$$eval(".cm-tooltip-autocomplete li", (els) => els.map((e) => e.textContent)).catch(() => []);
ok("plain `[[ZZBlk#` (no caret) still completes HEADINGS (Heading One)", headOpts.some((o) => o && o.includes("Heading One")), JSON.stringify(headOpts));
await page.keyboard.press("Escape");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n[[ZZSr");
await wait(300);
const fileOpts = await page.$$eval(".cm-tooltip-autocomplete li", (els) => els.map((e) => e.textContent)).catch(() => []);
ok("plain `[[ZZSr` still completes file basenames (ZZSrc)", fileOpts.some((o) => o && o.includes("ZZSrc")), JSON.stringify(fileOpts));

console.log(`\nR109 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
