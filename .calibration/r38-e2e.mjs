/**
 * R38 Quick Switcher sub-modes E2E — browser mode (Memory vault) vs dev :1420.
 * Run: node .calibration/r38-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 38 additions".
 *
 * `#query` = vault-wide heading search, `^query` = vault-wide block search.
 * Match logic is a pure core fn (core/switcherSearch) shared by the modal, the
 * browser E2E, and the desktop probe. Covers:
 *  A. pure search via window.__geodeSwitcher (mode parse + heading/block hits).
 *  B. live modal: real typing → heading/block rows → Enter navigates (+reveal).
 *  C. create row suppressed in #/^ modes; file mode still works.
 *  D. browse (empty #) lists the active file's headings first.
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
const consoleWarnings = [];
page.on("console", (msg) => {
  if (msg.type() === "warning" || msg.type() === "error") consoleWarnings.push(msg.text());
});
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r38", name: "r38", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeSwitcher, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FILES = {
  "r38/alpha.md": "# Alpha One\n\nbody\n\n## Section Two\n\nmore\n\n### Deep Three\n\npara with block ^blk1\n",
  "r38/beta.md": "# Beta Heading\n\ntext\n\n## Shared Section\n\nblock here ^blk2\n",
  "r38/gamma.md": "# Gamma Top\n",
};
for (const [p, c] of Object.entries(FILES)) {
  await app(async ([path, content]) => {
    try { await window.__app.vault.create(path, content); } catch { /* exists */ }
    await new Promise((r) => setTimeout(r, 30));
  }, [p, c]);
}
// wait for metadata to index headings + blocks
await page.waitForFunction(() => {
  const m = window.__app.metadata.getMetadata("r38/alpha.md");
  const b = window.__app.metadata.getMetadata("r38/beta.md");
  return m && m.headings.length >= 3 && m.blocks.length >= 1 && b && b.blocks.length >= 1;
}, null, { timeout: 6000 });

const activeFile = () => app(() => window.__app.workspace.getActiveFile());
const openSwitcher = async () => {
  await app(() => window.__app.workspace.openModal("switcher"));
  await page.waitForSelector("[data-testid=switcher-input]", { timeout: 4000 });
};

// ── A. pure search via __geodeSwitcher ───────────────────────────────────────
console.log("A. pure search (window.__geodeSwitcher)");
ok("mode('foo') = file", (await app(() => window.__geodeSwitcher.mode("foo"))) === "file");
ok("mode('#x') = heading", (await app(() => window.__geodeSwitcher.mode("#x"))) === "heading");
ok("mode('^y') = block", (await app(() => window.__geodeSwitcher.mode("^y"))) === "block");

const hSection = await app(() => window.__geodeSwitcher.headings("#Section").map((h) => h.text));
ok("headings('#Section') → 'Section Two' + 'Shared Section'",
  hSection.includes("Section Two") && hSection.includes("Shared Section"), JSON.stringify(hSection));
const hBeta = await app(() => window.__geodeSwitcher.headings("#Beta Heading"));
ok("headings('#Beta Heading') top = Beta Heading @ beta.md",
  hBeta.length >= 1 && hBeta[0].text === "Beta Heading" && hBeta[0].path === "r38/beta.md", JSON.stringify(hBeta[0]));
const hAll = await app(() => window.__geodeSwitcher.headings("#").length);
ok("headings('#') browse returns all (>=6)", hAll >= 6, String(hAll));

const bAll = await app(() => window.__geodeSwitcher.blocks("^blk").map((b) => b.id).sort());
ok("blocks('^blk') → blk1 + blk2", bAll.includes("blk1") && bAll.includes("blk2"), JSON.stringify(bAll));
const b2 = await app(() => window.__geodeSwitcher.blocks("^blk2"));
ok("blocks('^blk2') top = blk2 @ beta.md",
  b2.length >= 1 && b2[0].id === "blk2" && b2[0].path === "r38/beta.md", JSON.stringify(b2[0]));

// ── B. live modal: type → rows → Enter navigates ─────────────────────────────
console.log("B. live modal (real typing → heading/block rows → Enter)");
await openSwitcher();
await page.fill("[data-testid=switcher-input]", "#Beta Heading");
await wait(90);
const headingRowTexts = await app(() => [...document.querySelectorAll("[data-testid=switcher-item] .palette-item-name")].map((e) => e.textContent));
ok("live #: heading row shows 'Beta Heading'", headingRowTexts.some((t) => t.includes("Beta Heading")), JSON.stringify(headingRowTexts.slice(0, 5)));
await page.keyboard.press("Enter");
await wait(90);
ok("live #: Enter on heading navigates to beta.md", (await activeFile()) === "r38/beta.md", JSON.stringify(await activeFile()));

await openSwitcher();
await page.fill("[data-testid=switcher-input]", "^blk2");
await wait(90);
const blockRowTexts = await app(() => [...document.querySelectorAll("[data-testid=switcher-item] .palette-item-name")].map((e) => e.textContent));
ok("live ^: block row shows '^blk2'", blockRowTexts.some((t) => t.includes("blk2")), JSON.stringify(blockRowTexts.slice(0, 5)));
await page.keyboard.press("Enter");
await wait(90);
ok("live ^: Enter on block navigates to beta.md", (await activeFile()) === "r38/beta.md", JSON.stringify(await activeFile()));

// ── C. create row suppressed in #/^ modes; file mode intact ─────────────────
console.log("C. create row suppressed in sub-modes; file mode intact");
await openSwitcher();
await page.fill("[data-testid=switcher-input]", "#NoSuchHeadingXYZ");
await wait(90);
ok("heading mode shows NO create row", (await app(() => !!document.querySelector(".palette-create"))) === false);
await page.fill("[data-testid=switcher-input]", "alpha");
await wait(90);
const fileItems = await app(() => [...document.querySelectorAll("[data-testid=switcher-item]")].length);
ok("file mode still resolves (alpha → >=1 row)", fileItems >= 1, String(fileItems));
// a query that exactly matches no basename → create row appears (existing file-mode behavior)
await page.fill("[data-testid=switcher-input]", "brandnewnote123");
await wait(90);
const hasCreateFileMode = await app(() => !!document.querySelector(".palette-create"));
ok("file mode offers create row for a non-matching query", hasCreateFileMode === true);
await app(() => window.__app.workspace.closeModal());

// ── D. browse (#) lists the active file's headings first ─────────────────────
console.log("D. browse '#' active-file-first ordering");
await app(() => window.__app.workspace.openFile("r38/beta.md"));
await wait(40);
const browseFirst = await app(() => window.__geodeSwitcher.headings("#")[0]);
ok("browse '#' first hit is from active file (beta.md)", browseFirst.path === "r38/beta.md", JSON.stringify(browseFirst));

// ── E. block rows keyed by id — same-paragraph blocks share `from`, must not ──
//     collide on React key (R38 review hardening).
console.log("E. block React key uniqueness (same-paragraph two ^ids)");
await app(async () => {
  try { await window.__app.vault.create("r38/twoblocks.md", "first line ^aaa\nsecond line ^bbb\n"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
});
await page.waitForFunction(() => {
  const m = window.__app.metadata.getMetadata("r38/twoblocks.md");
  return m && m.blocks.length >= 2;
}, null, { timeout: 4000 });
const sameFrom = await app(() => {
  const b = window.__app.metadata.getMetadata("r38/twoblocks.md").blocks;
  return b.length >= 2 && b[0].from === b[1].from;
});
ok("precondition: same-paragraph blocks share `from`", sameFrom === true, String(sameFrom));
consoleWarnings.length = 0;
await openSwitcher();
await page.fill("[data-testid=switcher-input]", "^");
await wait(140);
const blkIds = await app(() => [...document.querySelectorAll("[data-testid=switcher-item] .palette-item-name")].map((e) => e.textContent));
ok("both same-paragraph blocks render (^aaa + ^bbb)",
  blkIds.some((t) => t.includes("aaa")) && blkIds.some((t) => t.includes("bbb")),
  JSON.stringify(blkIds.filter((t) => t.includes("aaa") || t.includes("bbb"))));
const dupKeyWarn = consoleWarnings.find((w) => /same key/i.test(w));
ok("no React duplicate-key warning (blocks keyed by id, not from)", dupKeyWarn === undefined, dupKeyWarn ?? "");
await app(() => window.__app.workspace.closeModal());

console.log(`\nR38 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
