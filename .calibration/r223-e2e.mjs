/**
 * R223 — Footnotes pane inline editing (Obsidian 1.9 native "Footnotes view":
 * "Click a footnote to edit its text"). Browser :1420. Run: node .calibration/r223-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 223 additions".
 *
 * The crux is data-safety (底线①): editing a footnote's text writes ONLY that definition
 * line via the shared DocumentHandle (second writer), byte-preserving everything else;
 * no-op edits don't churn; empty content trims clean; Escape cancels; navigation works.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r223", name: "r223", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const docText = (p) => app(([path]) => window.__app.documents.get(path)?.getText() ?? "(not open)", [p]);
const docRev = (p) => app(([path]) => window.__app.documents.get(path)?.revision.get() ?? -1, [p]);

const DOC = "---\ntitle: T\n---\nBody[^1] and more[^2].\n\n[^1]: first note\n[^2]: second note\n";
const FN = "fnedit.md";
await app(async ([path, body]) => {
  try { await window.__app.vault.create(path, body); } catch { /* exists — overwrite to a known state */
    const h = await window.__app.documents.acquire(path);
    h.applyExternalEdits([{ from: 0, to: h.getText().length, insert: body }]);
    h.release();
  }
}, [FN, DOC]);
await wait(200);
await app(([path]) => window.__app.workspace.openFile(path), [FN]);
await wait(200);
await page.click('[data-testid="right-tab-footnotes"]');
await page.waitForSelector('[data-testid="fn-item"]', { timeout: 4000 });
await wait(80);

console.log("— panel lists the note's footnotes —");
ok("two footnote items shown", (await page.locator('[data-testid="fn-item"]').count()) === 2);
ok("first content reads 'first note'", (await page.locator('[data-testid="fn-content"]').nth(0).innerText()) === "first note");
ok("markers shown (^1, ^2)", (await page.locator('[data-testid="fn-marker"]').nth(0).innerText()) === "^1");

console.log("— click a footnote to edit its text → writes ONLY that def line, byte-exact —");
await page.locator('[data-testid="fn-content"]').nth(0).click();
await page.waitForSelector('[data-testid="fn-edit-input"]', { timeout: 2000 });
ok("clicking content opens the inline editor", (await page.locator('[data-testid="fn-edit-input"]').count()) === 1);
await page.fill('[data-testid="fn-edit-input"]', "EDITED first");
await page.press('[data-testid="fn-edit-input"]', "Enter");
await wait(150);
const EXPECTED1 = "---\ntitle: T\n---\nBody[^1] and more[^2].\n\n[^1]: EDITED first\n[^2]: second note\n";
ok("doc bytes = only [^1] text changed, everything else verbatim", (await docText(FN)) === EXPECTED1, JSON.stringify(await docText(FN)));
ok("editor closed after commit", (await page.locator('[data-testid="fn-edit-input"]').count()) === 0);

console.log("— no-op edit (same text) does NOT write (no churn) —");
const revBefore = await docRev(FN);
await page.locator('[data-testid="fn-content"]').nth(0).click();
await page.waitForSelector('[data-testid="fn-edit-input"]', { timeout: 2000 });
await page.press('[data-testid="fn-edit-input"]', "Enter"); // commit unchanged
await wait(120);
ok("no-op commit left bytes unchanged", (await docText(FN)) === EXPECTED1);
ok("no-op commit did NOT bump the document revision (guard works)", (await docRev(FN)) === revBefore, `${revBefore} → ${await docRev(FN)}`);

console.log("— Escape cancels without writing —");
await page.locator('[data-testid="fn-content"]').nth(1).click();
await page.waitForSelector('[data-testid="fn-edit-input"]', { timeout: 2000 });
await page.fill('[data-testid="fn-edit-input"]', "SHOULD NOT PERSIST");
await page.press('[data-testid="fn-edit-input"]', "Escape");
await wait(120);
ok("Escape closed the editor", (await page.locator('[data-testid="fn-edit-input"]').count()) === 0);
ok("Escape left the document untouched", (await docText(FN)) === EXPECTED1, JSON.stringify(await docText(FN)));

console.log("— empty content trims to a bare [^id]: (no trailing space) —");
await page.locator('[data-testid="fn-content"]').nth(1).click();
await page.waitForSelector('[data-testid="fn-edit-input"]', { timeout: 2000 });
await page.fill('[data-testid="fn-edit-input"]', "");
await page.press('[data-testid="fn-edit-input"]', "Enter");
await wait(150);
const EXPECTED2 = "---\ntitle: T\n---\nBody[^1] and more[^2].\n\n[^1]: EDITED first\n[^2]:\n";
ok("empty edit → '[^2]:' bare, body preserved", (await docText(FN)) === EXPECTED2, JSON.stringify(await docText(FN)));

console.log("— marker navigates (dispatches scroll-to-definition, no error) —");
let scrolled = null;
await page.evaluate(() => { window.__r223jump = null; window.addEventListener("geode:scroll-to-heading", (e) => { window.__r223jump = e.detail; }); });
await page.locator('[data-testid="fn-marker"]').nth(0).click();
await wait(120);
scrolled = await app(() => window.__r223jump);
ok("clicking ^1 marker dispatched a scroll-to-definition event for fnedit.md", scrolled && scrolled.path === FN, JSON.stringify(scrolled));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR223 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
