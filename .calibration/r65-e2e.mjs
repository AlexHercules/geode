/**
 * R65 Footnotes pane E2E — browser mode against dev :1420.
 * Run: node .calibration/r65-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 65 additions".
 *
 * Covers ㉘ Footnotes view (Obsidian 1.9 core plugin): dedicated right-sidebar
 * tab listing the active note's [^id]: definitions (id + content) from the
 * metadata footnote index; fenced-code defs are excluded; click jumps (keeps the
 * file active); empty state; the app:show-footnotes command opens the pane.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r65", name: "r65", onload(app) { window.__app = app; } }));

const create = (p, c) => page.evaluate(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 80));
}, [p, c]);
const openFile = (p) => page.evaluate(async (path) => {
  window.__app.workspace.openFile(path);
  await new Promise((r) => setTimeout(r, 150));
}, p);
const fnItems = () => page.$$eval('[data-testid="fn-item"]', (els) =>
  els.map((e) => ({
    id: e.querySelector(".fn-marker")?.textContent ?? "",
    content: e.querySelector(".fn-content")?.textContent ?? "",
  })),
);

// A note with two footnote defs + a fenced-code line that LOOKS like a def (must be excluded)
await create("Notes.md", [
  "# Doc",
  "",
  "Body with a ref[^1] and a named one[^note]. Reuse[^1].",
  "",
  "```",
  "[^fenced]: this is inside a code fence and must NOT be indexed",
  "```",
  "",
  "[^1]: First footnote body.",
  "[^note]: Named footnote content.",
  "[^code]: `inline` then text.",
  "",
].join("\n"));
await create("Plain.md", "# Plain\n\nNo footnotes here.\n");

console.log("— open the Footnotes pane; lists definitions from the metadata index —");
await openFile("Notes.md");
await page.click('[data-testid="right-tab-footnotes"]');
await page.waitForSelector('[data-testid="footnotes-panel"]', { timeout: 4000 }).catch(() => {});
ok("footnotes tab opens the panel", (await page.$('[data-testid="footnotes-panel"]')) !== null);
const rows = await fnItems();
ok("exactly 3 footnotes indexed (fenced def excluded)", rows.length === 3, JSON.stringify(rows));
ok("footnote ^1 with its content", rows.some((r) => r.id === "^1" && r.content === "First footnote body."), JSON.stringify(rows));
ok("footnote ^note with its content", rows.some((r) => r.id === "^note" && r.content === "Named footnote content."), JSON.stringify(rows));
// review fix #1: a body starting with inline code keeps the code span (offset
// from the `]:` boundary on original text, not the masked content group)
ok("footnote ^code keeps a leading inline-code span", rows.some((r) => r.id === "^code" && r.content === "`inline` then text."), JSON.stringify(rows));
ok("fenced `[^fenced]` is NOT listed", !rows.some((r) => r.id.includes("fenced")), JSON.stringify(rows));
const count = await page.$eval('[data-testid="fn-count"]', (e) => e.textContent).catch(() => "?");
ok("count badge = 3", count === "3", count);

console.log("— clicking a footnote jumps (keeps the file active) —");
await page.evaluate(() => {
  const it = document.querySelector('[data-testid="fn-item"]');
  it?.click();
});
await page.waitForTimeout(180);
ok("clicking a footnote keeps Notes.md active (jump dispatched)", (await page.evaluate(() => window.__app.workspace.getActiveFile())) === "Notes.md");

console.log("— command opens the pane; switch away then command back —");
await page.evaluate(() => window.__app.workspace.setRightPanel("backlinks"));
await page.waitForTimeout(120);
ok("switched to backlinks (footnotes pane gone)", (await page.$('[data-testid="footnotes-panel"]')) === null);
await page.evaluate(() => window.__app.commands.execute("app:show-footnotes"));
await page.waitForSelector('[data-testid="footnotes-panel"]', { timeout: 3000 }).catch(() => {});
ok("app:show-footnotes command reopens the pane", (await page.$('[data-testid="footnotes-panel"]')) !== null);

console.log("— empty state: a note with no footnotes —");
await openFile("Plain.md");
await page.waitForTimeout(150);
ok("Plain.md → 0 footnote rows", (await fnItems()).length === 0, String((await fnItems()).length));
ok("shows the no-footnotes empty state", (await page.$('[data-testid="fn-empty"]')) !== null);

console.log(`\nR65 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
