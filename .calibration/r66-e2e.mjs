/**
 * R66 status-bar enhancements E2E — browser mode against dev :1420.
 * Run: node .calibration/r66-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 66 additions".
 *
 * Covers ㉙ (core status-bar items, per Obsidian): a backlink-count item that
 * tracks the active note's linked-mention total and updates when ANOTHER note's
 * links change (metadata.revision); and the word-count item showing "N selected
 * words" while the editor has a selection (reverting to the doc count on
 * deselect). Cursor line:col was dropped (not an Obsidian-core status item).
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r66", name: "r66", onload(app) { window.__app = app; } }));

const create = (p, c) => page.evaluate(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 80));
}, [p, c]);
const modify = (p, c) => page.evaluate(async ([path, content]) => {
  await window.__app.vault.modify(path, content);
  await new Promise((r) => setTimeout(r, 200));
}, [p, c]);
const openLive = (p) => page.evaluate(async (path) => {
  window.__app.workspace.openFile(path);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 220));
}, p);
const statusText = () => page.$eval('[data-testid="status-bar"]', (el) => el.textContent ?? "");

console.log("— backlink count tracks the active note + cross-file link changes —");
await create("NoteA.md", "# Note A\n\nbody.\n");
await create("Source.md", "see [[NoteA]] once.\n");
await openLive("NoteA.md");
await page.waitForTimeout(150);
ok("status bar shows 1 backlink for NoteA", (await statusText()).includes("1 backlinks"), await statusText());
// add a second mention in the OTHER note → metadata.revision bumps → recount
await modify("Source.md", "see [[NoteA]] and again [[NoteA]].\n");
await page.waitForTimeout(250);
ok("backlink count rises to 2 after editing Source", (await statusText()).includes("2 backlinks"), await statusText());
// open a note with no backlinks → count 0
await create("Lonely.md", "# Lonely\n");
await openLive("Lonely.md");
await page.waitForTimeout(150);
ok("a note with no backlinks shows 0 backlinks", (await statusText()).includes("0 backlinks"), await statusText());

console.log("— word count shows selected words while selecting, reverts on deselect —");
await create("WC.md", "one two three four five\n");
await openLive("WC.md");
await page.waitForTimeout(150);
ok("unselected: doc word count shown", (await statusText()).includes("words ·") && !(await statusText()).includes("selected"), await statusText());
await page.click(".cm-content");
await page.keyboard.press(`${MOD}+a`); // select all
await page.waitForTimeout(120);
ok("selecting shows '5 selected words'", (await statusText()).includes("5 selected words"), await statusText());
await page.keyboard.press("ArrowLeft"); // collapse selection
await page.waitForTimeout(120);
const afterDeselect = await statusText();
ok("deselect reverts to the doc word count", afterDeselect.includes("words ·") && !afterDeselect.includes("selected"), afterDeselect);

// review fix #2: typing over a selection collapses it in the SAME transaction
// (fires document:changed, not selection-changed) — the stale "N selected words"
// must clear. Select all, then type a char.
await page.keyboard.press(`${MOD}+a`);
await page.waitForTimeout(100);
ok("re-selected shows selected words again", (await statusText()).includes("selected"), await statusText());
await page.keyboard.type("z"); // replaces the whole selection with "z"
await page.waitForTimeout(150);
const afterTypeOver = await statusText();
ok("typing over a selection clears the stale 'selected words'", !afterTypeOver.includes("selected") && afterTypeOver.includes("words ·"), afterTypeOver);

console.log(`\nR66 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
