/**
 * R29 fold persistence + reading-view heading fold E2E — browser mode (Memory
 * vault) against dev :1420.
 * Run: node .calibration/r29-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 29 additions".
 *
 * Covers:
 *  1. foldStore probe round-trip (window.__geodeFold.save/load): Obsidian-shape
 *     {folds, lines} persists; empty folds → removeItem (load null); malformed
 *     raw → load null.
 *  2. editor fold persistence (real CM): fold-all → debounced save → preview↔
 *     editor round-trip → folds RESTORED (.cm-foldPlaceholder reappears);
 *     unfold-all → save cleared.
 *  3. reading-view heading fold: click a heading collapses its section (siblings
 *     until next same-or-higher heading get .geode-heading-folded); toggle back;
 *     nested sub-heading folds independently; link inside heading navigates
 *     (fold guard `!el.closest("a")` lets it fall through).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r29", name: "r29", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeFold, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const openMode = (p, mode) => app(async ([path, m]) => {
  window.__app.workspace.openFile(path);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, m);
  await new Promise((r) => setTimeout(r, 160));
}, [p, mode]);
const setMode = (mode) => app(async (m) => {
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, m);
  await new Promise((r) => setTimeout(r, 200));
}, mode);
const runCmd = (id) => app((cid) => window.__app.commands.execute(cid), id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. foldStore probe round-trip ───────────────────────────────────────────
console.log("— foldStore probe round-trip —");
const rt = await app(() => {
  const path = "probe/fold-rt.md";
  const info = { folds: [{ from: 1, to: 3 }, { from: 6, to: 9 }], lines: 20 };
  window.__geodeFold.save(path, info);
  const back = window.__geodeFold.load(path);
  return { back, key: localStorage.getItem("geode.fold." + path) };
});
ok("save→load round-trips {folds,lines} verbatim",
  JSON.stringify(rt.back) === JSON.stringify({ folds: [{ from: 1, to: 3 }, { from: 6, to: 9 }], lines: 20 }),
  JSON.stringify(rt.back));
ok("localStorage key is geode.fold.<path>", typeof rt.key === "string" && rt.key.includes('"folds"'));

const emptied = await app(() => {
  const path = "probe/fold-empty.md";
  window.__geodeFold.save(path, { folds: [{ from: 0, to: 2 }], lines: 5 });
  window.__geodeFold.save(path, { folds: [], lines: 5 }); // empty → removeItem
  return { load: window.__geodeFold.load(path), raw: localStorage.getItem("geode.fold." + path) };
});
ok("empty folds → removeItem (no empty key left)", emptied.raw === null);
ok("load after clear returns null", emptied.load === null);

const malformed = await app(() => {
  localStorage.setItem("geode.fold.probe/bad.md", "{not json");
  const a = window.__geodeFold.load("probe/bad.md");
  localStorage.setItem("geode.fold.probe/bad2.md", JSON.stringify({ folds: "nope", lines: 1 }));
  const b = window.__geodeFold.load("probe/bad2.md");
  return { a, b };
});
ok("malformed JSON → load null", malformed.a === null);
ok("wrong-shape (folds not array) → load null", malformed.b === null);

// ── 2. editor fold persistence (real CodeMirror) ────────────────────────────
console.log("— editor fold persistence (real CM round-trip) —");
const FOLDS_FILE = "R29 Folds.md";
await create(FOLDS_FILE,
  "# Top\n\nintro\n\n## Section A\n\naaa\n\nbbb\n\n## Section B\n\nccc\n");
await openMode(FOLDS_FILE, "live");
await page.click(".cm-content").catch(() => {});
await wait(80);
await runCmd("editor:fold-all");
await wait(150);
const foldedCount1 = await page.$$eval(".cm-foldPlaceholder", (els) => els.length);
ok("fold-all produces fold placeholders in editor", foldedCount1 > 0, `count=${foldedCount1}`);

await wait(500); // let the 400ms debounce fire
const saved = await app((p) => window.__geodeFold.load(p), FOLDS_FILE);
ok("fold-all persisted to localStorage (folds captured)", !!saved && saved.folds.length > 0, JSON.stringify(saved));
ok("persisted lines = doc line count", !!saved && saved.lines === 14, JSON.stringify(saved));

// preview round-trip: view destroyed (flush) then rebuilt (restore)
await setMode("preview");
await setMode("live");
await wait(150);
const foldedCount2 = await page.$$eval(".cm-foldPlaceholder", (els) => els.length);
ok("folds RESTORED after preview↔editor round-trip", foldedCount2 > 0, `count=${foldedCount2}`);

// unfold-all clears persisted state
await page.click(".cm-content").catch(() => {});
await runCmd("editor:unfold-all");
await wait(550);
const cleared = await app((p) => window.__geodeFold.load(p), FOLDS_FILE);
ok("unfold-all clears persisted folds (load null)", cleared === null, JSON.stringify(cleared));

// ── 3. reading-view heading fold ────────────────────────────────────────────
console.log("— reading-view heading fold —");
await create("Link Target.md", "# Link Target\n\nhi\n");
const RV_FILE = "R29 Reading.md";
await create(RV_FILE,
  "# Top\n\nintro para\n\n## Section A\n\na para 1\n\na para 2\n\n### Sub A1\n\nsub para\n\n## Section B\n\nb para\n\n## See [[Link Target]] here\n\ntail\n");
await openMode(RV_FILE, "preview");
await page.waitForSelector(".preview-content h2");

const hiddenCount = () => page.$$eval(".preview-content .geode-heading-folded", (e) => e.length);
const clickHeadingByText = (txt) => page.evaluate((t) => {
  const h = [...document.querySelectorAll(".preview-content h1,.preview-content h2,.preview-content h3")]
    .find((el) => el.textContent.trim().startsWith(t));
  if (h) h.click();
  return !!h;
}, txt);

// fold Section A (h2): hides "a para 1","a para 2", h3 Sub A1, "sub para" = 4
await clickHeadingByText("Section A");
await wait(60);
ok("click h2 collapses section (4 siblings hidden until next h2)", (await hiddenCount()) === 4, `hidden=${await hiddenCount()}`);
const aCollapsed = await page.evaluate(() =>
  [...document.querySelectorAll(".preview-content h2")].find((e) => e.textContent.includes("Section A"))?.classList.contains("is-collapsed"));
ok("folded heading gets .is-collapsed", aCollapsed === true);

// toggle back
await clickHeadingByText("Section A");
await wait(60);
ok("click again expands (0 hidden)", (await hiddenCount()) === 0, `hidden=${await hiddenCount()}`);

// nested independence: fold Sub A1 (h3) first, then Section A (h2), then expand A
await clickHeadingByText("Sub A1");
await wait(40);
ok("fold nested h3 hides only its sub-section (1 hidden)", (await hiddenCount()) === 1, `hidden=${await hiddenCount()}`);
await clickHeadingByText("Section A");
await wait(40);
ok("fold outer h2 hides whole section incl. nested", (await hiddenCount()) === 4, `hidden=${await hiddenCount()}`);
await clickHeadingByText("Section A");
await wait(40);
// expanding A reveals direct children but Sub A1 stays collapsed → its sub para hidden
const afterExpand = await hiddenCount();
const subA1Collapsed = await page.evaluate(() =>
  [...document.querySelectorAll(".preview-content h3")].find((e) => e.textContent.includes("Sub A1"))?.classList.contains("is-collapsed"));
ok("expand outer respects nested collapsed (Sub A1 sub para still hidden = 1)", afterExpand === 1, `hidden=${afterExpand}`);
ok("nested Sub A1 retains .is-collapsed after outer expand", subA1Collapsed === true);
// cleanup nested state
await clickHeadingByText("Sub A1");
await wait(40);

// link inside heading: clicking the link navigates (fold guard lets it fall through)
const before = await app(() => window.__app.workspace.getActiveFile());
await page.click('.preview-content h2 a.internal-link[data-target="Link Target"]').catch(() => {});
await wait(150);
const after = await app(() => window.__app.workspace.getActiveFile());
ok("link inside heading navigates (fold guard !closest('a'))", after === "Link Target.md" && after !== before, `${before}→${after}`);

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\nR29 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
