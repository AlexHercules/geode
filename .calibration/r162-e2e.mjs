/**
 * R162 — Tier 7 C4: editor-header bookmark (star) toggle button — browser :1420.
 * Run: node .calibration/r162-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 162 additions" (Tier 7 C4).
 *
 * Visible bookmark toggle in EditorPane .editor-header — reuses R27 vetted
 * bookmarks.toggleFile / isFileBookmarked / items Store. MemoryVaultAdapter.
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
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r162", name: "r162", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TID = "[data-testid=bookmark-toggle]";
const pressed = () => page.getAttribute(TID, "aria-pressed");
const fill = () => page.getAttribute(`${TID} svg`, "fill");
const hasActive = () => page.$eval(TID, (el) => el.className.includes("is-active"));

// create + open a note
await ev(async () => { await window.__app.vault.create("r162-test.md", "hi r162"); window.__app.workspace.openFile("r162-test.md"); });
await page.waitForSelector(TID, { timeout: 5000 });
await wait(80);

console.log("— button present + default unbookmarked state —");
ok("bookmark-toggle present + visible", await page.isVisible(TID));
ok("aria-pressed=false by default", (await pressed()) === "false");
ok("icon outline by default (fill=none)", (await fill()) === "none");
ok("no is-active class by default", !(await hasActive()));

console.log("— click toggles ON (filled + accent) —");
await page.click(TID);
await wait(80);
ok("aria-pressed=true after click", (await pressed()) === "true");
ok("icon filled (fill=currentColor)", (await fill()) === "currentColor");
ok("is-active class present when bookmarked", await hasActive());

console.log("— click toggles OFF —");
await page.click(TID);
await wait(80);
ok("aria-pressed=false after second click", (await pressed()) === "false");
ok("icon outline again", (await fill()) === "none");

console.log("— live sync: command path updates the button (useStore subscription) —");
await ev(() => window.__app.commands.execute("bookmarks:bookmark-file"));
await wait(80);
ok("button reflects command bookmark (aria-pressed=true)", (await pressed()) === "true");
await ev(() => window.__app.commands.execute("bookmarks:bookmark-file"));
await wait(80);
ok("button reflects command un-bookmark (aria-pressed=false)", (await pressed()) === "false");

console.log("— per-file state: star is bound to the active file —");
await page.click(TID); // bookmark r162-test
await wait(80);
ok("r162-test bookmarked", (await pressed()) === "true");
await ev(async () => { await window.__app.vault.create("r162-other.md", "other"); window.__app.workspace.openFile("r162-other.md"); });
await wait(120);
ok("r162-other shows unbookmarked", (await pressed()) === "false");
await ev(() => window.__app.workspace.openFile("r162-test.md"));
await wait(120);
ok("switching back to r162-test shows bookmarked", (await pressed()) === "true");
await page.click(TID); // cleanup: unbookmark
await wait(60);

console.log("— button hidden when no file-backed editor (graph tab) —");
await ev(() => window.__app.workspace.openGraph());
await wait(120);
ok("bookmark-toggle absent on graph tab", (await page.$(TID)) === null);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR162: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
