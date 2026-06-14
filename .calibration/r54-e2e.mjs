/**
 * R54 Setext heading folding E2E — browser vs :1420.
 * Run: node .calibration/r54-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 54 additions".
 *
 *  A. pure fold-range geometry (window.__geodeFoldRange): Setext + ATX section ends.
 *  B. live folding: editor:toggle-fold on a Setext heading collapses its section.
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r54", name: "r54", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeFoldRange, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A. pure fold-range geometry (window.__geodeFoldRange) ────────────────────
console.log("A. pure fold-range (window.__geodeFoldRange)");
// blank-separated so a setext underline doesn't merge an adjacent paragraph into the
// heading. L1-2 Setext H1, L4 para, L6-7 Setext H2, L9 para, L10 ATX H1, L11 para.
// "H1\n==\n\npara1\n\nH2\n--\n\npara2\n# A\nend\n"
const DOC = "H1\n==\n\npara1\n\nH2\n--\n\npara2\n# A\nend\n";
const r = (line) => app(([d, l]) => window.__geodeFoldRange.range(d, l), [DOC, line]);
ok("Setext H1 (L1) folds to before sibling ATX → {2,26}", eq(await r(1), { from: 2, to: 26 }), JSON.stringify(await r(1)));
ok("Setext H2 (L6) subsection folds → {16,26}", eq(await r(6), { from: 16, to: 26 }), JSON.stringify(await r(6)));
ok("ATX H1 (L10) section to doc end → {30,35}", eq(await r(10), { from: 30, to: 35 }), JSON.stringify(await r(10)));
ok("paragraph line (L4) is not foldable → null", (await r(4)) === null, JSON.stringify(await r(4)));
ok("Setext underline line (L2) is not foldable → null", (await r(2)) === null, JSON.stringify(await r(2)));
// a multi-line setext heading (underline applies to the whole preceding paragraph) folds
// from its FIRST line; continuation lines are not independently foldable.
const DOC3 = "lineA\nlineB\n===\n";
ok("multi-line Setext folds from first line → {5,16}", eq(await app(([d]) => window.__geodeFoldRange.range(d, 1), [DOC3]), { from: 5, to: 16 }), JSON.stringify(await app(([d]) => window.__geodeFoldRange.range(d, 1), [DOC3])));
ok("Setext continuation line is not foldable → null", (await app(([d]) => window.__geodeFoldRange.range(d, 2), [DOC3])) === null);

// ── B. live folding (editor:toggle-fold on a Setext heading) ─────────────────
console.log("B. live folding (editor:toggle-fold)");
const SRC = "SF.md";
await app(async (p) => { try { await window.__app.vault.create(p, "Title\n=====\nbody one\nbody two\n"); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, SRC);
await app(async (p) => {
  window.__app.workspace.openFile(p);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, SRC);
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await wait(80);
const placeholders = () => page.locator(".cm-foldPlaceholder").count();
ok("no fold placeholder before folding", (await placeholders()) === 0);
// cursor on the Setext heading text line (offset 0), fold
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(40);
await app(() => window.__app.commands.execute("editor:toggle-fold"));
await wait(120);
ok("toggle-fold on Setext heading collapses the section", (await placeholders()) === 1, `placeholders=${await placeholders()}`);
// the heading text is still visible (only the section folded)
ok("heading text stays visible after fold", (await app(() => window.__app.documents.getActiveView()?.view.state.doc.toString() ?? "")).startsWith("Title\n"));
// unfold
await app(() => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: 0 } }); });
await wait(40);
await app(() => window.__app.commands.execute("editor:toggle-fold"));
await wait(120);
ok("toggle-fold again unfolds", (await placeholders()) === 0, `placeholders=${await placeholders()}`);

console.log(`\nR54 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
