/**
 * R24 unlinked-mentions E2E — browser mode (Memory vault) against dev server :1420.
 * Run: node .calibration/r24-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 24 additions".
 *
 * Covers: detection (basename + alias), exclusions (existing link / inline code /
 * word-boundary plural), Link-all rewrite + surface preservation, CJK substring
 * matching, and the three review-fixed data-safety scenarios — body `#tag` at
 * offset 0 (must NOT be linked), and a wikilink-illegal name `C#` (Link must
 * skip, leaving the file byte-for-byte unchanged).
 */
import { chromium } from "playwright";

const URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
// deterministic locale + a clean probe handle
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => {
  window.geode.registerPlugin({ id: "r24probe", name: "r24probe", onload(app) { window.__app = app; } });
});
const app = (fn, arg) => page.evaluate(fn, arg);

/** open `path`, focus the backlinks panel, expand the unlinked section, and
 *  wait until the async scan settles (no "Searching…" placeholder). */
async function openAndScan(path) {
  await app(async (p) => {
    window.__app.workspace.openFile(p);
    window.__app.workspace.setRightPanel("backlinks");
    await new Promise((r) => setTimeout(r, 150));
  }, path);
  await page.waitForSelector('[data-testid="bl-section-unlinked"]');
  // ensure the section is expanded (default collapsed)
  const expanded = await page.$eval('[data-testid="bl-section-unlinked"]', (el) => el.getAttribute("aria-expanded") === "true");
  if (!expanded) await page.click('[data-testid="bl-section-unlinked"]');
  // wait for scan to settle
  await page.waitForFunction(() => {
    const body = document.querySelector('[data-testid="bl-section-unlinked"]')?.parentElement?.querySelector(".bl-section-body");
    if (!body) return false;
    return !/Searching|搜索中/.test(body.textContent || "");
  }, null, { timeout: 8000 });
}
const oneCount = () => page.$$eval('[data-testid="bl-link-one"]', (e) => e.length);
const groupCount = () => page.$$eval('[data-testid="bl-link-all"]', (e) => e.length);
const read = (p) => app((path) => window.__app.vault.read(path), p);
const flush = () => app(async () => { await window.__app.workspace.flushAll(); });
const create = (p, c) => app(async ([path, content]) => {
  await window.__app.vault.create(path, content);
  await new Promise((r) => setTimeout(r, 80));
}, [p, c]);

console.log("— detection: basename + alias, with exclusions (demo fixture) —");
await openAndScan("Zettelkasten.md");
ok("one source group (On Knowledge.md)", (await groupCount()) === 1);
ok("exactly 4 unlinked mentions (3 'Zettelkasten' + 1 alias 'ZK')", (await oneCount()) === 4,
  `got ${await oneCount()}`);
// exclusions are proven by the count being exactly 4: the existing [[Zettelkasten]],
// the inline-code `Zettelkasten`, and the plural "Zettelkastens" are all omitted.

console.log("— Link all: rewrite + surface preservation —");
await page.click('[data-testid="bl-link-all"]');
await page.waitForFunction(() => document.querySelectorAll('[data-testid="bl-link-one"]').length === 0, null, { timeout: 8000 });
await flush();
let txt = await read("On Knowledge.md");
ok("3 plain mentions -> [[Zettelkasten]] (4 total incl. pre-existing)",
  (txt.match(/\[\[Zettelkasten\]\]/g) || []).length === 4, JSON.stringify(txt));
ok("alias mention -> [[ZK]] (surface preserved)", txt.includes("[[ZK]]"));
ok("inline-code `Zettelkasten` left intact", txt.includes("`Zettelkasten`"));
ok("plural 'Zettelkastens' left intact (word boundary)", txt.includes('"Zettelkastens"'));
ok("unlinked section now empty", (await oneCount()) === 0);

console.log("— CJK substring matching (runtime fixtures) —");
await create("学习笔记.md", "知识管理是一种方法。我喜欢知识管理。\n\n另见 [[知识管理]]。\n");
await create("知识管理.md", "# 知识管理\n\n关于知识管理的索引笔记。\n");
await openAndScan("知识管理.md");
ok("CJK name matched as bare substring: 2 unlinked (flanked by CJK)", (await oneCount()) === 2,
  `got ${await oneCount()}`);
// the [[知识管理]] linked occurrence is correctly excluded (count is 2, not 3)

console.log("— data-safety C1: body #tag at offset 0 is NOT a mention —");
await create("TagTop.md", "#Widget is pinned at the very top.\n\nA plain Widget appears here too.\n");
await create("Widget.md", "# Widget\n\nIndex note.\n");
await openAndScan("Widget.md");
ok("tag-at-offset-0 excluded; only the prose 'Widget' counts (1, not 2)", (await oneCount()) === 1,
  `got ${await oneCount()}`);

console.log("— data-safety C2: wikilink-illegal name 'C#' -> Link skips, file unchanged —");
await create("Sharp.md", "I love C# a lot.\n");
await create("C#.md", "# C Sharp\n\nIndex note for the language.\n");
await openAndScan("C#.md");
ok("'C#' mention detected", (await oneCount()) === 1, `got ${await oneCount()}`);
const before = await read("Sharp.md");
await page.click('[data-testid="bl-link-one"]');
await page.waitForTimeout(400); // allow the (skipping) write op to settle
await flush();
const after = await read("Sharp.md");
ok("Sharp.md byte-for-byte unchanged (post-rewrite verification skipped the bad link)",
  before === after, JSON.stringify(after));
ok("no broken [[C#]] / [[C]] written", !after.includes("[["));

console.log(`\nR24 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
