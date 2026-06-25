/**
 * R224 — Editor setting "Hide reference marks" (Obsidian native, Display group, default ON).
 * Browser :1420. Run: node .calibration/r224-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 224 additions".
 *
 * ON (default): Live Preview hides Markdown syntax delimiters except at the cursor.
 * OFF: all delimiters stay visible, BUT widgets (hr) + styles still render — NOT source mode.
 * Single gate = livePreview.ts hide() helper; reconfigured via the mode compartment in EditorPane.
 * Toggle is driven through the real Settings UI (app:open-settings → Editor tab → toggle).
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
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.removeItem("geode.hideReferenceMarks"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r224", name: "r224", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const content = () => app(() => document.querySelector(".cm-content")?.textContent ?? "(no editor)");
const hasHr = () => app(() => !!document.querySelector(".cm-live-hr"));
const openFile = (path) => app(([p]) => window.__app.workspace.openFile(p), [path]);

// line 1 plain (cursor parks at pos 0 → line-2 marks are NOT cursor-revealed); hr at line 4
const DOC = "first line plain\nsecond has **bold** word\n\n***\n";
const FN = "hidemarks.md";
// idempotent: a page reload wipes the in-memory vault, so re-seed after reload too
const ensureFile = () => app(async ([path, body]) => {
  if (!window.__app.vault.fileExists(path)) await window.__app.vault.create(path, body);
}, [FN, DOC]);

await ensureFile();
await wait(150);
await openFile(FN);
await page.waitForSelector(".cm-content", { timeout: 5000 });
await wait(250);

console.log("— default ON: line-2 bold marks hidden, but text + hr widget render —");
let c = await content();
ok("default ON: '**' delimiters hidden (no '**bold**' in text)", !c.includes("**bold**"), JSON.stringify(c));
ok("default ON: the bold word text is still present", c.includes("bold"), JSON.stringify(c));
ok("default ON: hr renders as a widget (.cm-live-hr present)", await hasHr());
ok("default ON: '***' hr delimiters not in text (widget, not raw)", !c.includes("***"), JSON.stringify(c));

console.log("— toggle OFF via the real Settings UI → marks shown, widgets still render —");
await app(() => window.__app.commands.execute("app:open-settings"));
await page.waitForSelector('[data-testid="settings-modal"]', { timeout: 4000 });
await page.click('[data-testid="settings-nav-editor"]');
await page.waitForSelector('[data-testid="settings-hide-reference-marks-toggle"]', { timeout: 4000 });
const wasOn = await page.evaluate(() => document.querySelector('[data-testid="settings-hide-reference-marks-toggle"]').getAttribute("aria-checked"));
ok("settings toggle reflects default ON (aria-checked=true)", wasOn === "true", String(wasOn));
await page.click('[data-testid="settings-hide-reference-marks-toggle"]');
await wait(150);
await page.click('[data-testid="settings-close"]');
await wait(300);
c = await content();
ok("OFF: '**' delimiters now VISIBLE ('**bold**' in text)", c.includes("**bold**"), JSON.stringify(c));
ok("OFF: hr STILL a widget (.cm-live-hr present → NOT source mode)", await hasHr());

console.log("— OFF persists across reload —");
ok("localStorage persisted hideReferenceMarks=false", (await app(() => localStorage.getItem("geode.hideReferenceMarks"))) === "false", await app(() => localStorage.getItem("geode.hideReferenceMarks")));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r224b", name: "r224b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await ensureFile(); // re-seed if the reload wiped the in-memory vault
await wait(120);
await openFile(FN);
await page.waitForSelector(".cm-content", { timeout: 5000 });
await wait(300);
c = await content();
ok("after reload, OFF restored → '**bold**' still visible", c.includes("**bold**"), JSON.stringify(c));

console.log("— toggle back ON (cleanup + reverse direction works) —");
await app(() => window.__app.commands.execute("app:open-settings"));
await page.waitForSelector('[data-testid="settings-modal"]', { timeout: 4000 });
await page.click('[data-testid="settings-nav-editor"]');
await page.waitForSelector('[data-testid="settings-hide-reference-marks-toggle"]', { timeout: 4000 });
await page.click('[data-testid="settings-hide-reference-marks-toggle"]');
await wait(150);
await page.click('[data-testid="settings-close"]');
await wait(300);
c = await content();
ok("back ON: '**' delimiters hidden again", !c.includes("**bold**"), JSON.stringify(c));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR224 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
