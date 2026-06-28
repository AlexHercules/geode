/**
 * R247 (G2-b) settings Editor page section-subheaders E2E — browser mode :1420.
 * Run: node .calibration/r247-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 247 additions".
 *
 * Extends R246's `.settings-subheader` grouping to the Editor page: reorders 17 flat settings into
 * 顶部(headerless) → 显示(Display) → 行为(Behavior) + adds the 显示/行为 subheaders (reference 01).
 * Pure IA reorder — every original setting-item testid/binding is preserved verbatim. Asserts all
 * original testids present, both subheaders exist, and the visual order is correct.
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
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r247", name: "r247", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-editor"]');
await page.waitForSelector('[data-testid="settings-readable-toggle"]', { timeout: 3000 });
await wait(80);

console.log("— every original Editor setting-item testid is preserved (pure reorder) —");
const ORIGINAL = [
  "settings-view-mode-toggle", "settings-focus-new-tab-toggle", "settings-readable-toggle",
  "settings-spellcheck-toggle", "settings-strict-linebreaks-toggle", "settings-line-numbers-toggle",
  "settings-hide-reference-marks-toggle", "settings-rtl-toggle", "settings-autopair-toggle",
  "settings-autopair-markdown-toggle", "settings-smart-lists-toggle", "settings-backlinks-indoc-toggle",
  "settings-fold-heading-toggle", "settings-newtab-view", "settings-newtab-editmode",
  "settings-indent-tabs-toggle", "settings-tab-indent-size",
  "settings-properties-display",
];
const present = await app((ids) => ids.filter((id) => !!document.querySelector(`[data-testid="${id}"]`)), ORIGINAL);
ok(`all ${ORIGINAL.length} original testids present (${present.length})`, present.length === ORIGINAL.length, JSON.stringify(ORIGINAL.filter((id) => !present.includes(id))));

console.log("— the 显示 / 行为 subheaders exist with the right text —");
const subs = await app(() => ({
  display: document.querySelector('[data-testid="settings-subheader-display"]')?.textContent?.trim() ?? null,
  behavior: document.querySelector('[data-testid="settings-subheader-behavior"]')?.textContent?.trim() ?? null,
  cls: document.querySelector('[data-testid="settings-subheader-display"]')?.className ?? null,
}));
ok("显示 subheader present, text = 'Display'", subs.display === "Display", JSON.stringify(subs));
ok("行为 subheader present, text = 'Behavior'", subs.behavior === "Behavior", JSON.stringify(subs));
ok("subheader uses .settings-subheader class", subs.cls === "settings-subheader", JSON.stringify(subs));

console.log("— faithful DOM order: 顶部 → 显示 subheader → 显示 group → 行为 subheader → 行为 group —");
const tops = await app(() => {
  const top = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect().top : NaN; };
  return {
    focus: top('[data-testid="settings-focus-new-tab-toggle"]'),
    viewmode: top('[data-testid="settings-view-mode-toggle"]'),
    dispSub: top('[data-testid="settings-subheader-display"]'),
    readable: top('[data-testid="settings-readable-toggle"]'),
    backlinks: top('[data-testid="settings-backlinks-indoc-toggle"]'),
    behSub: top('[data-testid="settings-subheader-behavior"]'),
    spell: top('[data-testid="settings-spellcheck-toggle"]'),
  };
});
ok("顶部(focus-new-tab) is above the 显示 subheader", tops.focus < tops.dispSub, JSON.stringify(tops));
ok("顶部 view-mode toggle is above the 显示 subheader (moved up from mid-list)", tops.viewmode < tops.dispSub, JSON.stringify(tops));
ok("显示 subheader is above the 显示 group (readable)", tops.dispSub < tops.readable, JSON.stringify(tops));
ok("backlinks-indoc sits in 显示 (above the 行为 subheader)", tops.backlinks < tops.behSub, JSON.stringify(tops));
ok("显示 group is above the 行为 subheader", tops.readable < tops.behSub, JSON.stringify(tops));
ok("行为 subheader is above the 行为 group (spellcheck, moved down from near top)", tops.behSub < tops.spell, JSON.stringify(tops));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR247 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
