/**
 * R62 Outgoing Links pane E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r62-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 62 additions".
 *
 * Covers ㉓ dedicated Outgoing Links panel (separate right-sidebar tab, Obsidian
 * core-plugin parity): tab opens the pane; resolved links list under "Links",
 * unresolved under "Unresolved links" (styled is-unresolved); clicking a
 * resolved link navigates; the `app:show-outgoing-links` command opens the pane;
 * empty state when no markdown file is active. Reuses metadata.getOutgoingLinks.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r62", name: "r62", onload(app) { window.__app = app; } }));

const create = (p, c) => page.evaluate(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 60));
}, [p, c]);
const openFile = (p) => page.evaluate(async (path) => {
  window.__app.workspace.openFile(path);
  await new Promise((r) => setTimeout(r, 150));
}, p);

await create("Alpha.md", "# Alpha\n");
await create("Beta.md", "# Beta\n");
// Source links to two existing notes (resolved) + one ghost (unresolved)
await create("Source.md", "# Source\n\nsee [[Alpha]] and [[Beta]] plus [[Ghost Note]].\n");

console.log("— open the Outgoing Links pane via its tab —");
await openFile("Source.md");
await page.waitForSelector('[data-testid="right-tab-outgoinglinks"]', { timeout: 4000 }).catch(() => {});
ok("outgoing-links tab exists", (await page.$('[data-testid="right-tab-outgoinglinks"]')) !== null);
await page.click('[data-testid="right-tab-outgoinglinks"]');
await page.waitForSelector('[data-testid="outgoinglinks-panel"]', { timeout: 4000 }).catch(() => {});
ok("clicking the tab shows the outgoing-links panel", (await page.$('[data-testid="outgoinglinks-panel"]')) !== null);

console.log("— resolved links under Links, ghost under Unresolved —");
const rows = await page.$$eval('[data-testid="outgoinglinks-panel"] [data-testid="ol-link"]', (els) =>
  els.map((e) => ({ text: e.textContent.replace(/new$/i, "").trim(), unresolved: e.classList.contains("is-unresolved") })),
);
ok("Alpha listed as a resolved link", rows.some((r) => r.text === "Alpha" && !r.unresolved), JSON.stringify(rows));
ok("Beta listed as a resolved link", rows.some((r) => r.text === "Beta" && !r.unresolved), JSON.stringify(rows));
ok("Ghost Note listed as unresolved (red)", rows.some((r) => r.text === "Ghost Note" && r.unresolved), JSON.stringify(rows));
const linksCount = await page.$eval('[data-testid="ol-section-links"] .ol-count', (e) => e.textContent).catch(() => "?");
const unresCount = await page.$eval('[data-testid="ol-section-unresolved"] .ol-count', (e) => e.textContent).catch(() => "?");
ok("Links section count = 2", linksCount === "2", linksCount);
ok("Unresolved section count = 1", unresCount === "1", unresCount);

console.log("— clicking a resolved link navigates to that note —");
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('[data-testid="outgoinglinks-panel"] [data-testid="ol-link"]')];
  const alpha = btns.find((b) => b.textContent.trim().startsWith("Alpha"));
  alpha?.click();
});
await page.waitForTimeout(200);
const activeAfterClick = await page.evaluate(() => window.__app.workspace.getActiveFile());
ok("clicking Alpha opens Alpha.md", activeAfterClick === "Alpha.md", activeAfterClick);

console.log("— command opens the pane; switch away then command back —");
await page.evaluate(() => window.__app.workspace.setRightPanel("backlinks"));
await page.waitForTimeout(120);
ok("switched to backlinks (pane gone)", (await page.$('[data-testid="outgoinglinks-panel"]')) === null);
await page.evaluate(() => window.__app.commands.execute("app:show-outgoing-links"));
await page.waitForSelector('[data-testid="outgoinglinks-panel"]', { timeout: 3000 }).catch(() => {});
ok("app:show-outgoing-links command reopens the pane", (await page.$('[data-testid="outgoinglinks-panel"]')) !== null);

console.log("— empty state: a note with no outgoing links —");
await openFile("Alpha.md");
await page.waitForTimeout(150);
const emptyRows = await page.$$eval('[data-testid="outgoinglinks-panel"] [data-testid="ol-link"]', (els) => els.length).catch(() => -1);
ok("Alpha.md has 0 outgoing link rows", emptyRows === 0, String(emptyRows));
const noLinks = await page.$('[data-testid="outgoinglinks-panel"] .ol-empty-sub');
ok("shows a 'no links' empty-sub message", noLinks !== null);

console.log("— R212: non-markdown active tab FOLLOWS lastActiveFile (not the no-file empty) —");
// the graph view has no markdown file of its own, but R212 the panel now follows
// lastActiveFile (Alpha.md, which has 0 outgoing links) — the same Obsidian-faithful
// fallback R211 gave backlinks. So it shows the no-LINKS empty-sub (Alpha), NOT the
// no-FILE ol-empty container.
await page.evaluate(() => window.__app.workspace.openGraph());
await page.waitForTimeout(150);
await page.evaluate(() => window.__app.commands.execute("app:show-outgoing-links"));
await page.waitForTimeout(200);
ok("graph tab → panel follows lastActiveFile (Alpha) → no-links empty-sub, NOT no-file ol-empty",
  (await page.$('[data-testid="outgoinglinks-panel"] .ol-empty-sub')) !== null && (await page.$('[data-testid="ol-empty"]')) === null);
ok("still 0 link rows (Alpha has no outgoing links)", (await page.$$eval('[data-testid="ol-link"]', (e) => e.length).catch(() => -1)) === 0);

console.log(`\nR62 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
