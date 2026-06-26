/**
 * R246 (G2-b) settings Appearance page section-subheaders E2E — browser mode :1420.
 * Run: node .calibration/r246-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 246 additions".
 *
 * Obsidian groups each settings page's rows under gray subheadings (reference 03 §三/§五).
 * R246 reorders the Appearance page into 主题(headerless) → 界面 → 字体 and adds the 界面/字体
 * subheaders. Pure IA reorder: every original setting-item testid/binding is preserved verbatim,
 * only positions change. Asserts: all original testids still present, both subheaders exist, and the
 * visual order is 主题 → 界面 subheader → 界面 group → 字体 subheader → 字体 group.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r246", name: "r246", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-appearance"]');
await page.waitForSelector('[data-testid="settings-theme-select"]', { timeout: 3000 });
await wait(80);

console.log("— every original Appearance setting-item testid is preserved (pure reorder) —");
const ORIGINAL = [
  "settings-theme-select", "settings-accent-color", "obsidian-css-toggle", "obsidian-theme-select",
  "settings-inline-title-toggle", "settings-tab-title-bar-toggle", "settings-ribbon-toggle", "settings-status-bar-toggle",
  "settings-font-interface", "settings-font-text", "settings-font-monospace", "settings-font-size", "settings-quick-font-zoom-toggle",
];
const present = await app((ids) => ids.filter((id) => !!document.querySelector(`[data-testid="${id}"]`)), ORIGINAL);
ok(`all ${ORIGINAL.length} original testids present (${present.length})`, present.length === ORIGINAL.length, JSON.stringify(ORIGINAL.filter((id) => !present.includes(id))));

console.log("— the 界面 / 字体 subheaders exist with the right text —");
const subs = await app(() => ({
  iface: document.querySelector('[data-testid="settings-subheader-interface"]')?.textContent?.trim() ?? null,
  fonts: document.querySelector('[data-testid="settings-subheader-fonts"]')?.textContent?.trim() ?? null,
  ifaceClass: document.querySelector('[data-testid="settings-subheader-interface"]')?.className ?? null,
}));
ok("界面 subheader present, text = 'Interface'", subs.iface === "Interface", JSON.stringify(subs));
ok("字体 subheader present, text = 'Fonts'", subs.fonts === "Fonts", JSON.stringify(subs));
ok("subheader uses .settings-subheader class", subs.ifaceClass === "settings-subheader", JSON.stringify(subs));

console.log("— faithful DOM order: 主题 → 界面 subheader → 界面 group → 字体 subheader → 字体 group —");
const tops = await app(() => {
  const top = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect().top : NaN; };
  return {
    theme: top('[data-testid="settings-theme-select"]'),
    ifaceSub: top('[data-testid="settings-subheader-interface"]'),
    inline: top('[data-testid="settings-inline-title-toggle"]'),
    fontsSub: top('[data-testid="settings-subheader-fonts"]'),
    font: top('[data-testid="settings-font-interface"]'),
    accent: top('[data-testid="settings-accent-color"]'),
  };
});
ok("主题(theme) is above the 界面 subheader", tops.theme < tops.ifaceSub, JSON.stringify(tops));
ok("界面 subheader is above the 界面 group (inline title)", tops.ifaceSub < tops.inline, JSON.stringify(tops));
ok("界面 group is above the 字体 subheader", tops.inline < tops.fontsSub, JSON.stringify(tops));
ok("字体 subheader is above the 字体 group (interface font)", tops.fontsSub < tops.font, JSON.stringify(tops));
ok("accent (主题) sits above the 字体 group — fonts no longer precede the toggles", tops.accent < tops.font && tops.accent < tops.ifaceSub, JSON.stringify(tops));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR246 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
