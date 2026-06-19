/**
 * R98 backlinks "Show more context" E2E — browser mode :1420.
 * Run: node .calibration/r98-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 98 additions" (㊷ 续).
 *
 * A toggle expands each backlink snippet from the matched LINE to the surrounding
 * PARAGRAPH (blank-line delimited). Panel-side (re-reads source content for linked
 * mentions only when on), no getBacklinks/index change. Pure front-end, no .md writes.
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
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); localStorage.removeItem("geode.backlinksContext"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r98", name: "r98", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeBacklinkParagraph, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const ls = (k) => app(([key]) => localStorage.getItem(key), [k]);
const para = (content, from) => app(([c, f]) => window.__geodeBacklinkParagraph(c, f), [content, from]);
const snippetText = () => app(() => {
  const el = document.querySelector('[data-testid="backlinks-panel"] [data-testid="bl-snippet"]');
  return el ? el.textContent : null;
});

// ── paragraph boundary logic (probe) ────────────────────────────────────────
console.log("— paragraph boundary (probe) —");
const C = "a\nb match\nc\n\nd\n"; // "match" at offset 4; blank line before "d"
ok("paragraph = the block of non-blank lines around the offset", (await para(C, 4)) === "a\nb match\nc", JSON.stringify(await para(C, 4)));
ok("a different paragraph (after the blank line) is isolated", (await para(C, 13)) === "d", JSON.stringify(await para(C, 13)));
ok("a single-line note → just that line", (await para("solo line", 0)) === "solo line");
ok("offset inside the first line still gets the whole paragraph", (await para(C, 0)) === "a\nb match\nc");

// ── real panel: line snippet → paragraph on toggle ──────────────────────────
console.log("— backlinks panel more-context toggle —");
await create("A.md", "# A\n");
await create("B.md", "first line of para\nmid [[A]] mention\nlast line of para\n\nseparate para\n");
await wait(300);
await app(() => window.__app.workspace.openFile("A.md"));
await wait(150);
await page.click('[data-testid="right-tab-backlinks"]').catch(() => {});
await page.waitForSelector('[data-testid="backlinks-panel"]', { timeout: 4000 }).catch(() => {});
ok("backlinks panel shows B as a backlink", await app(() => !!document.querySelector('[data-testid="bl-snippet"]')));
const lineSnip = await snippetText();
ok("default snippet is the matched LINE only (no surrounding lines)",
  lineSnip !== null && lineSnip.includes("mention") && !lineSnip.includes("first line of para"), JSON.stringify(lineSnip));
ok("more-context toggle present", await app(() => !!document.querySelector('[data-testid="bl-context-toggle"]')));
await page.click('[data-testid="bl-context-toggle"]');
await wait(250); // async re-read of the source for the paragraph
const paraSnip = await snippetText();
ok("after toggle the snippet shows the whole PARAGRAPH (surrounding lines)",
  paraSnip !== null && paraSnip.includes("first line of para") && paraSnip.includes("last line of para"), JSON.stringify(paraSnip));
ok("the separate paragraph (after the blank line) is NOT included", paraSnip !== null && !paraSnip.includes("separate para"), JSON.stringify(paraSnip));
ok("toggle-on persists to localStorage", (await ls("geode.backlinksContext")) === "1");

// toggle back → line snippet again
await page.click('[data-testid="bl-context-toggle"]');
await wait(150);
const backToLine = await snippetText();
ok("toggling off returns to the line snippet", backToLine !== null && !backToLine.includes("first line of para"), JSON.stringify(backToLine));
ok("toggle-off persists (0)", (await ls("geode.backlinksContext")) === "0");

// ── F1: stale-paragraph guard across file switch (shared backlink source) ───
console.log("— file-switch stale guard (review F1) —");
// C links to BOTH A and B, in DIFFERENT paragraphs
await create("C.md", "alpha block\nlink to [[A]] one\nalpha tail\n\nbeta block\nlink to [[B]] two\nbeta tail\n");
await wait(300);
const allSnips = () => app(() =>
  [...document.querySelectorAll('[data-testid="backlinks-panel"] [data-testid="bl-snippet"]')].map((e) => e.textContent).join("\n---\n"));
await app(() => window.__app.workspace.openFile("A.md"));
await wait(200);
const ctxOn = await app(() => document.querySelector('[data-testid="bl-context-toggle"]')?.classList.contains("is-active"));
if (!ctxOn) { await page.click('[data-testid="bl-context-toggle"]'); await wait(300); }
const onA = await allSnips();
ok("on A, shared source C shows A's paragraph", onA.includes("alpha block"), onA);
// switch to B — C must NOT still show A's stale 'alpha block' paragraph
await app(() => window.__app.workspace.openFile("B.md"));
await wait(350); // file switch + async re-read for B
const onB = await allSnips();
ok("after A→B switch, no snippet shows A's stale 'alpha block'", !onB.includes("alpha block"), onB);
ok("on B, shared source C shows B's paragraph", onB.includes("beta block"), onB);

console.log(`\nR98 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
