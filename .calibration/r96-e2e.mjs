/**
 * R96 Excluded files E2E — browser mode :1420.
 * Run: node .calibration/r96-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 96 additions" (㊽ 续续续).
 *
 * Path patterns (glob `*` / `{regex}`) hide matching files from search + the graph and
 * dim them in the file explorer (still openable). Pure front-end, no .md writes.
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
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); localStorage.removeItem("geode.excludedFiles"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r96", name: "r96", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeExcluded, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const ex = (raw, path) => app(([r, p]) => window.__geodeExcluded(r, p), [raw, path]);
const searchNames = () => app(() =>
  Array.from(document.querySelectorAll('[data-testid="search-result"] .search-file-name')).map((e) => e.textContent));
const rowExcluded = (path) => app(([p]) => {
  const el = document.querySelector(`[data-testid="explorer-item"][data-path="${p}"]`);
  return el ? el.classList.contains("is-excluded") : null;
}, [path]);
const setPatterns = async (raw) => {
  await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 250)); });
  await page.fill('[data-testid="settings-excluded-files"]', raw);
  await wait(120);
  await app(() => window.__app.workspace.closeModal());
  await wait(150);
};

// ── pattern matching (probe) ────────────────────────────────────────────────
console.log("— pattern matching (probe) —");
ok("folder glob 'Archive/' matches a file under it", (await ex("Archive/", "Archive/old.md")) === true);
ok("folder glob 'Archive/' does not match a sibling", (await ex("Archive/", "keep.md")) === false);
ok("extension glob '*.png' matches an attachment", (await ex("*.png", "a/b.png")) === true);
ok("extension glob '*.png' does not match a .md", (await ex("*.png", "a/b.md")) === false);
ok("{regex} anchored pattern matches", (await ex("{regex}^drafts/", "drafts/x.md")) === true);
ok("{regex} anchored pattern respects the anchor", (await ex("{regex}^drafts/", "x/drafts/y.md")) === false);
ok("invalid {regex} line is ignored (no throw, no match)", (await ex("{regex}[", "x.md")) === false);
ok("empty pattern list excludes nothing", (await ex("", "anything.md")) === false);
ok("multi-line: any line can match", (await ex("foo\nbar/", "bar/baz.md")) === true);
// '?' is a LITERAL in a glob (Obsidian: only '*' is a wildcard) — not a regex quantifier
ok("'?' in a glob is literal (matches a path with '?')", (await ex("a?c", "x/a?c.md")) === true);
ok("'?' in a glob is not a wildcard (does not match 'abc')", (await ex("a?c", "x/abc.md")) === false);

// ── search exclusion (real) ─────────────────────────────────────────────────
console.log("— search exclusion —");
await create("keep.md", "needle here\n");
await create("Archive/old.md", "needle here\n");
await create("img.png", "x");
await ex("", "reset"); // clear patterns left by the probe
await wait(80);
await setPatterns("Archive/\n*.png");
await app(() => window.__app.workspace.requestSearch("needle"));
await wait(400);
const names = await searchNames();
ok("non-excluded file appears in search", names.includes("keep"), JSON.stringify(names));
ok("excluded folder's file is hidden from search", !names.includes("old"), JSON.stringify(names));

// ── explorer dim (real) ─────────────────────────────────────────────────────
console.log("— explorer dim —");
// expand the Archive folder so its child row renders
await app(() => { window.__app.workspace.setLeftPanel?.("explorer"); });
await wait(120);
ok("excluded .png file row is dimmed", (await rowExcluded("img.png")) === true, JSON.stringify(await rowExcluded("img.png")));
ok("non-excluded file row is NOT dimmed", (await rowExcluded("keep.md")) === false);

// ── reactivity: clearing patterns un-hides + un-dims ────────────────────────
console.log("— reactivity —");
await setPatterns("");
await app(() => window.__app.workspace.requestSearch("needle"));
await wait(400);
const after = await searchNames();
ok("clearing patterns brings the excluded file back to search", after.includes("old"), JSON.stringify(after));
// switch back to the explorer panel (requestSearch swapped it for the search panel)
await app(() => window.__app.workspace.setLeftPanel?.("explorer"));
await wait(150);
ok("clearing patterns removes the explorer dim", (await rowExcluded("img.png")) === false, JSON.stringify(await rowExcluded("img.png")));

console.log(`\nR96 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
