/**
 * R75 query-embed E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r75-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 75 additions" (㊲).
 *
 * Covers: runQueryBlock (via __geodeQueryBlock) — match/empty/error — AND the
 * rendered result list in reading view + live preview, with click navigation on
 * a result's internal-link (the shared-widget passthrough).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r75", name: "r75", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeQueryBlock, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
const runQuery = (raw) => app(([r]) => window.__geodeQueryBlock(r), [raw]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FENCE = "```";
await create("qzz/one.md", "first note\n");
await create("qzz/two.md", "second note\n");
await create("qzz/three.md", "third note\n");
await create("other.md", "unrelated\n");
await create("host.md", `# Host\n\n${FENCE}query\npath:qzz\n${FENCE}\n`);
await wait(400);

// ── runQueryBlock logic (via probe hook) ────────────────────────────────────
console.log("— runQueryBlock —");
const r1 = await runQuery("path:qzz");
ok("path:qzz → 3 matched files", r1.total === 3, JSON.stringify(r1));
ok("paths are the qzz notes, sorted", JSON.stringify(r1.paths) === JSON.stringify(["qzz/one.md", "qzz/three.md", "qzz/two.md"]), JSON.stringify(r1.paths));
const r2 = await runQuery("path:nonexistentZZ");
ok("no matches → total 0", r2.total === 0 && r2.paths.length === 0, JSON.stringify(r2));
const r3 = await runQuery("(unclosed");
ok("invalid query → error set", typeof r3.error === "string" && r3.error.length > 0, JSON.stringify(r3));
const r4 = await runQuery("");
ok("empty query → total 0, no error", r4.total === 0 && r4.error === undefined, JSON.stringify(r4));

// ── reading view: placeholder → result list ─────────────────────────────────
console.log("— reading view render —");
await app(async () => {
  window.__app.workspace.openFile("host.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "preview");
  await new Promise((r) => setTimeout(r, 600));
});
ok("query placeholder hydrated to results", await app(() => !!document.querySelector('.editor-preview [data-testid="query-results"]')));
ok("result count shows '3 results'", (await app(() => document.querySelector(".editor-preview .geode-query-count")?.textContent)) === "3 results");
ok("3 file rows rendered", await app(() => document.querySelectorAll('.editor-preview .geode-query-file').length === 3));
ok("result rows are internal-link with full-path data-target", await app(() => {
  const a = document.querySelector('.editor-preview .geode-query-file a.internal-link[data-target="qzz/one.md"]');
  return !!a && a.textContent === "one";
}));

// ── reading-view click navigation ───────────────────────────────────────────
console.log("— reading click nav —");
const readLink = await page.$('.editor-preview .geode-query-file a.internal-link[data-target="qzz/two.md"]');
ok("result link present", readLink !== null);
if (readLink) {
  await readLink.click();
  await wait(300);
  ok("clicking a result opens that note", await app(() => window.__app.workspace.getActiveTab()?.filePath === "qzz/two.md"));
}

// ── live preview: widget + result list + click nav ──────────────────────────
console.log("— live preview render + click —");
await app(async () => {
  window.__app.workspace.openFile("host.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 700));
});
ok("live query widget mounts", await app(() => !!document.querySelector('[data-testid="cm-live-query"]')));
ok("live widget hydrated to result list", await app(() => !!document.querySelector('[data-testid="cm-live-query"] [data-testid="query-results"]')));
const liveLink = await page.$('[data-testid="cm-live-query"] a.internal-link[data-target="qzz/three.md"]');
ok("live result link present", liveLink !== null);
if (liveLink) {
  await liveLink.click();
  await wait(300);
  ok("clicking a live result navigates (widget passthrough)", await app(() => window.__app.workspace.getActiveTab()?.filePath === "qzz/three.md"));
}

// ── error render (invalid query in reading view) ────────────────────────────
console.log("— error render —");
await create("badhost.md", `# Bad\n\n${FENCE}query\n(unclosed\n${FENCE}\n`);
await wait(150);
await app(async () => {
  window.__app.workspace.openFile("badhost.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "preview");
  await new Promise((r) => setTimeout(r, 500));
});
ok("invalid query renders an error plate", await app(() => !!document.querySelector(".editor-preview .geode-query-error")));

console.log(`\nR75 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
