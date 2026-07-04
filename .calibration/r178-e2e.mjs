/**
 * R178 — G2-a: Settings modal visual calibration — browser :1420.
 * Run: node .calibration/r178-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 178 additions" (G2-a).
 *
 * Pure-frontend visual calibration of the settings window toward Obsidian:
 *  1. Fix the light-mode whole-window blue focus ring — the modal root takes
 *     programmatic focus (tabIndex=-1 + .focus()) and WebKit painted a UA
 *     outline around the whole panel; Obsidian never shows that state.
 *  2. Theme control: segmented 3-button → dropdown (Obsidian「基础颜色方案」).
 *  3. Wider modal (760→900) + wider nav (170→200) + section-heading divider.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.geode.app, null, { timeout: 15000 });
await page.evaluate(() => { window.__app = window.geode.app; });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const present = (sel) => page.$(sel).then((h) => !!h);
const tid = (id) => `[data-testid="${id}"]`;
const openSettings = async () => {
  await ev(() => window.__app.workspace.openModal("settings"));
  await page.waitForSelector(tid("settings-modal"), { timeout: 5000 });
  await wait(80);
};
const closeSettings = async () => { await page.click(tid("settings-close")); await wait(60); };
const nav = async (id) => { await page.click(tid(`settings-nav-${id}`)); await wait(50); };

await openSettings();

console.log("— (1) focus-ring bug: modal root must not paint an outline —");
ok("modal root takes programmatic focus on open", await ev(() => {
  const m = document.querySelector('[data-testid="settings-modal"]');
  return !!m && document.activeElement === m;
}));
ok("focused modal root has outline-style: none (no blue ring painted)", await ev(() => {
  const m = document.querySelector('[data-testid="settings-modal"]');
  // outline-style:none suppresses rendering regardless of computed width.
  return getComputedStyle(m).outlineStyle === "none";
}));

console.log("— (2) theme control is a dropdown, not segmented —");
await nav("appearance");
ok("theme select present", await present(tid("settings-theme-select")));
ok("theme control is a <select>", await ev(() =>
  document.querySelector('[data-testid="settings-theme-select"]')?.tagName === "SELECT"));
ok("old segmented theme buttons are gone", await ev(() =>
  !document.querySelector('[data-testid="settings-theme-dark"]') &&
  !document.querySelector('[data-testid="settings-theme-light"]') &&
  !document.querySelector('[data-testid="settings-theme-system"]')));
ok("dropdown has 3 options (system/light/dark)", await ev(() => {
  const s = document.querySelector('[data-testid="settings-theme-select"]');
  const vals = Array.from(s.options).map((o) => o.value).sort().join(",");
  return vals === "dark,light,system";
}));

console.log("— theme dropdown drives workspace.setTheme + reflects state —");
await page.locator(tid("settings-theme-select")).selectOption("dark");
await wait(60);
ok("select dark → workspace theme=dark", await ev(() => window.__app.workspace.state.get().theme === "dark"));
ok("select value reflects dark", await ev(() =>
  document.querySelector('[data-testid="settings-theme-select"]').value === "dark"));
await page.locator(tid("settings-theme-select")).selectOption("light");
await wait(60);
ok("select light → workspace theme=light", await ev(() => window.__app.workspace.state.get().theme === "light"));
await page.locator(tid("settings-theme-select")).selectOption("system");
await wait(60);
ok("select system → workspace theme=system", await ev(() => window.__app.workspace.state.get().theme === "system"));

console.log("— binding survives reopen (controlled value, not severed) —");
await page.locator(tid("settings-theme-select")).selectOption("dark");
await wait(60);
await closeSettings();
await openSettings();
await nav("appearance");
ok("reopened dropdown shows persisted theme=dark", await ev(() =>
  document.querySelector('[data-testid="settings-theme-select"]').value === "dark"));

console.log("— (3) visual calibration: wider modal / nav / heading divider —");
ok("settings panel widened (>800, was 760)", await ev(() =>
  document.querySelector('[data-testid="settings-modal"]').offsetWidth > 800));
ok("settings panel near 900px target", await ev(() => {
  const w = document.querySelector('[data-testid="settings-modal"]').offsetWidth;
  return w >= 880 && w <= 904;
}));
ok("left nav widened toward 232 (was 170 → 200 → 232)", await ev(() => {
  const nav = document.querySelector(".settings-nav");
  return !!nav && nav.offsetWidth >= 226 && nav.offsetWidth <= 238;
}));
ok("section heading has a bottom divider", await ev(() => {
  const h = document.querySelector(".settings-heading");
  if (!h) return false;
  const cs = getComputedStyle(h);
  return cs.borderBottomStyle === "solid" && cs.borderBottomWidth !== "0px";
}));

// reset theme so we don't leave the harness in a non-default state
await page.locator(tid("settings-theme-select")).selectOption("dark");
await wait(40);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR178: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
