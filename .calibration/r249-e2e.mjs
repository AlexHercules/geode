/**
 * R249 (G2-b) settings dropdown native-look fidelity E2E — browser mode :1420.
 * Run: node .calibration/r249-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 249 additions".
 *
 * Obsidian's dropdowns use a custom chevron, not the native OS arrow (reference 00 §四). R249 gives
 * `.settings-select` appearance:none + a themeable two-gradient `v` chevron. Asserts via computed
 * style (appearance none + 2 linear-gradients) and that selection still works (appearance:none must
 * not break the control).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r249", name: "r249", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-appearance"]');
await page.waitForSelector('[data-testid="settings-theme-select"]', { timeout: 3000 });
await wait(80);

console.log("— .settings-select drops the native arrow (appearance:none) + draws a custom chevron —");
const cs = await app(() => {
  const el = document.querySelector('[data-testid="settings-theme-select"]');
  const s = getComputedStyle(el);
  return {
    appearance: s.appearance,
    webkit: s.webkitAppearance,
    bgImage: s.backgroundImage,
    padRight: s.paddingRight,
    usesMuted: (() => { const p = document.createElement("span"); document.body.appendChild(p); p.style.color = "var(--text-muted)"; const c = getComputedStyle(p).color; p.remove(); return c; })(),
  };
});
ok("appearance is 'none' (native OS arrow removed)", cs.appearance === "none" || cs.webkit === "none", JSON.stringify(cs));
const grads = (cs.bgImage.match(/linear-gradient/g) || []).length;
ok("background-image draws a 2-gradient chevron", grads === 2, `linear-gradients=${grads} :: ${cs.bgImage}`);
ok("chevron color resolves to --text-muted (themeable, present in the gradient)", cs.bgImage.includes(cs.usesMuted), JSON.stringify({ bg: cs.bgImage, muted: cs.usesMuted }));
ok("extra right padding clears the chevron", parseFloat(cs.padRight) >= 20, cs.padRight);

console.log("— appearance:none does NOT break selection (the control still works) —");
const before = await app(() => document.querySelector('[data-testid="settings-theme-select"]').value);
await page.selectOption('[data-testid="settings-theme-select"]', "light");
await wait(80);
const after = await app(() => document.querySelector('[data-testid="settings-theme-select"]').value);
ok("selectOption changes the value (control functional)", after === "light" && after !== before, `before=${before} after=${after}`);
// restore
await page.selectOption('[data-testid="settings-theme-select"]', before).catch(() => {});

console.log("— the same class styles other selects (link-path-format on the Files page) —");
await page.click('[data-testid="settings-nav-files-and-links"]');
await page.waitForSelector('[data-testid="settings-link-path-format"]', { timeout: 3000 });
await wait(60);
const cs2 = await app(() => {
  const el = document.querySelector('[data-testid="settings-link-path-format"]');
  const s = getComputedStyle(el);
  return { appearance: s.appearance, webkit: s.webkitAppearance, grads: (s.backgroundImage.match(/linear-gradient/g) || []).length };
});
ok("link-path-format select shares the custom-chevron styling", (cs2.appearance === "none" || cs2.webkit === "none") && cs2.grads === 2, JSON.stringify(cs2));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR249 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
