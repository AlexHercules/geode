/**
 * R30 Properties sidebar view E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r30-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 30 additions".
 *
 * NOTE: the Memory vault ships a seed sample vault, so assertions use uniquely
 * prefixed property keys (ap*) that cannot collide with seed frontmatter.
 *
 * Covers:
 *  1. aggregation probe (window.__geodeProperties.keyCounts/values): vault-wide
 *     key→file counts (case-insensitive merge), distinct sorted values per key.
 *  2. global rename probe (window.__geodeProperties.rename): closed-file rewrite
 *     across the vault — key text changed, VALUE BYTES INTACT, other properties
 *     untouched; filesChanged count; collision → that file skipped (uncounted);
 *     no-op (same key) → 0 changed; open file rewritten via buffer.
 *  3. panel UI: right-tab opens AllPropertiesPanel; filter; count badge; expand
 *     → file list; click file opens it.
 *  4. in-document value datalist: a text property's <datalist> carries the
 *     vault-wide distinct values.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r30", name: "r30", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeProperties, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const read = (p) => app((path) => window.__app.vault.read(path), p);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── seed a small vault (unique ap* keys, immune to the sample vault) ──────────
await create("ap/a.md", "---\napauth: Ada\napstat: draft\napkinds:\n  - x\n  - y\n---\n# A\n");
await create("ap/b.md", "---\napauth: Bob\napstat: done\n---\n# B\n");
await create("ap/c.md", "---\nApauth: Cleo\n---\n# C\n"); // different casing → merges
await create("ap/d.md", "# D no frontmatter\n");
await create("ap/e.md", "---\nCasekey: v\n---\n# E\n"); // for case-only rename
await wait(300);

// ── 1. aggregation probe ─────────────────────────────────────────────────────
console.log("— aggregation probe —");
const counts = await app(() => Object.fromEntries(window.__geodeProperties.keyCounts()));
ok("apauth counted across a/b/c (case-insensitive merge) = 3", counts["apauth"] === 3, JSON.stringify(counts));
ok("apstat counted across a/b = 2", counts["apstat"] === 2, JSON.stringify(counts));
ok("apkinds counted in a only = 1", counts["apkinds"] === 1, JSON.stringify(counts));

const authorVals = await app(() => window.__geodeProperties.values("apauth"));
ok("values(apauth) distinct + sorted", JSON.stringify(authorVals) === JSON.stringify(["Ada", "Bob", "Cleo"]), JSON.stringify(authorVals));
const kindVals = await app(() => window.__geodeProperties.values("APKINDS")); // case-insensitive key
ok("values(APKINDS) reads list items case-insensitively", JSON.stringify(kindVals) === JSON.stringify(["x", "y"]), JSON.stringify(kindVals));

// ── 2. global rename probe ───────────────────────────────────────────────────
console.log("— global rename probe —");
const renameRes = await app(() => window.__geodeProperties.rename("apauth", "apwriter"));
ok("rename apauth→apwriter changed 3 files", renameRes.filesChanged === 3, JSON.stringify(renameRes));
ok("rename reported 0 skipped", renameRes.skipped.length === 0);
const a1 = await read("ap/a.md");
ok("a.md key renamed, value byte-intact", a1.includes("apwriter: Ada") && !a1.includes("apauth:"), a1);
ok("a.md other props untouched (apstat/apkinds)", a1.includes("apstat: draft") && a1.includes("- x"), a1);
const c1 = await read("ap/c.md");
ok("c.md (different casing source) renamed to apwriter", c1.includes("apwriter: Cleo") && !/Apauth:/.test(c1), c1);

// no-op: same key
const noop = await app(() => window.__geodeProperties.rename("apstat", "apstat"));
ok("no-op rename (same key) changes 0 files", noop.filesChanged === 0, JSON.stringify(noop));

// collision: a.md & b.md now have apwriter AND apstat → renaming apstat→apwriter
// must be a per-file null (builder collision) → uncounted skip. c.md has neither
// apstat, so nothing renamed anywhere → filesChanged 0.
const collide = await app(() => window.__geodeProperties.rename("apstat", "apwriter"));
ok("collision rename: files holding the target key are skipped (uncounted)",
  collide.filesChanged === 0, JSON.stringify(collide));
const a2 = await read("ap/a.md");
ok("collision: a.md apstat NOT renamed (apwriter already present)", a2.includes("apstat: draft") && a2.includes("apwriter: Ada"), a2);

// case-only rename (Author→author) — Obsidian supports this; the case-INSENSITIVE
// post-rewrite "old key gone" assertion must be skipped for case-only renames
const caseRes = await app(() => window.__geodeProperties.rename("Casekey", "casekey"));
ok("case-only rename (Casekey→casekey) changes 1 file (C1 regression)", caseRes.filesChanged === 1, JSON.stringify(caseRes));
const e1 = await read("ap/e.md");
ok("case-only: e.md key is now lowercase, value intact", e1.includes("casekey: v") && !/Casekey:/.test(e1), e1);

// open-file buffer path: open b.md, then rename a key it holds
await app(async () => {
  window.__app.workspace.openFile("ap/b.md");
  await new Promise((r) => setTimeout(r, 150));
});
const openRes = await app(() => window.__geodeProperties.rename("apstat", "apphase"));
ok("rename touches the open file (apstat→apphase) — ≥1 file changed", openRes.filesChanged >= 1, JSON.stringify(openRes));
// read the live document buffer (applyExternalEdits is immediate; the disk save
// is debounced) — proves the open-file path went through the buffer, not disk
const b1 = await app(() => window.__app.documents.get("ap/b.md")?.getText() ?? "");
ok("open b.md buffer key renamed apstat→apphase", b1.includes("apphase: done") && !b1.includes("apstat:"), b1);

// ── 3. panel UI ──────────────────────────────────────────────────────────────
console.log("— panel UI —");
await page.click('[data-testid="right-tab-allproperties"]');
await page.waitForSelector('[data-testid="allproperties-panel"]', { timeout: 4000 });
ok("AllPropertiesPanel renders on tab click", await page.isVisible('[data-testid="allproperties-panel"]'));

// apwriter key row + count badge (apwriter now in a,b,c = 3)
await page.waitForSelector('[data-testid="ap-row-apwriter"]', { timeout: 4000 });
const writerCount = await page.textContent('[data-testid="ap-count-apwriter"]');
ok("apwriter row count badge = 3", writerCount.trim() === "3", writerCount);

// filter
await page.fill('[data-testid="ap-filter"]', "apphase");
await wait(120);
ok("filter shows matching row (apphase)", await page.isVisible('[data-testid="ap-row-apphase"]'));
ok("filter hides non-matching row (apwriter)", !(await page.isVisible('[data-testid="ap-row-apwriter"]')));
await page.fill('[data-testid="ap-filter"]', "");
await wait(120);

// expand apwriter → file list, click a file opens it
await page.click('[data-testid="ap-row-apwriter"]');
await wait(120);
const apFile = await page.$('.ap-entry .ap-files .ap-file');
ok("expanding a row reveals its file list", apFile !== null);
if (apFile) {
  await apFile.click();
  await wait(150);
  const activePath = await app(() => window.__app.workspace.getActiveTab()?.filePath);
  ok("clicking a file in the list opens it", typeof activePath === "string" && activePath.startsWith("ap/"), String(activePath));
}

// ── 4. in-document value datalist ────────────────────────────────────────────
console.log("— in-document value datalist —");
// open a.md in LIVE mode; PropertiesPanel renders datalist of vault-wide values
await app(async () => {
  window.__app.workspace.openFile("ap/a.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 300));
});
await page.waitForSelector('[data-testid="properties-panel"]', { timeout: 4000 }).catch(() => {});
const hasPanel = await page.isVisible('[data-testid="properties-panel"]');
ok("properties panel visible in editor (live)", hasPanel);
if (hasPanel) {
  // 'apwriter' (text) value editor has a datalist listing vault-wide values
  const opts = await page.evaluate(() => {
    const input = document.querySelector('[data-testid="property-value-apwriter"]');
    if (!input) return null;
    const listId = input.getAttribute("list");
    if (!listId) return null;
    const dl = document.getElementById(listId);
    return dl ? Array.from(dl.querySelectorAll("option")).map((o) => o.value) : null;
  });
  ok("apwriter value editor has a datalist of vault values",
    Array.isArray(opts) && opts.includes("Ada") && opts.includes("Bob") && opts.includes("Cleo"),
    JSON.stringify(opts));
}

console.log(`\nR30 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
