/**
 * R227 appearance "Quick font size adjustment" (Ctrl/Cmd + wheel) E2E — browser mode :1420.
 * Run: node .calibration/r227-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 227 additions".
 *
 * Obsidian's "Quick font size adjustment" (default OFF): hold Ctrl/Cmd + scroll to change the font
 * size. Geode installs a global wheel listener gated on a persisted toggle; it reuses the vetted
 * workspace.setFontSize (clamped [11,28]). Default OFF = no wheel zoom (zero-regression).
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
await page.evaluate(() => { try { localStorage.removeItem("geode.quickFontZoom"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r227", name: "r227", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fontSize = () => app(() => window.__app.workspace.state.get().fontSize);
const setFont = (px) => app(([p]) => window.__app.workspace.setFontSize(p), [px]);
const wheel = (deltaY, ctrl = false, meta = false) => app(([dy, c, m]) => {
  window.dispatchEvent(new WheelEvent("wheel", { deltaY: dy, ctrlKey: c, metaKey: m, cancelable: true }));
}, [deltaY, ctrl, meta]);
const toggleZoom = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-appearance"]');
  await wait(80);
  await page.waitForSelector("[data-testid=settings-quick-font-zoom-toggle]", { timeout: 3000 });
  await page.click("[data-testid=settings-quick-font-zoom-toggle]");
  await wait(60);
  await app(() => window.__app.workspace.closeModal());
  await wait(60);
};

await setFont(16);
await wait(60);

console.log("— default OFF: Ctrl+wheel does NOT change the font size —");
await wheel(-120, true);
await wait(60);
ok("default OFF: Ctrl+wheel up leaves fontSize at 16", (await fontSize()) === 16, String(await fontSize()));

console.log("— toggle ON: Ctrl/Cmd+wheel adjusts the font size —");
await toggleZoom();
await wheel(-120, true); // scroll up → bigger
await wait(60);
ok("ON: Ctrl+wheel up → fontSize 17", (await fontSize()) === 17, String(await fontSize()));
await wheel(120, true); // scroll down → smaller
await wait(60);
ok("ON: Ctrl+wheel down → fontSize 16", (await fontSize()) === 16, String(await fontSize()));
await wheel(-120, false, true); // Cmd+wheel up (mac) → bigger
await wait(60);
ok("ON: Cmd+wheel up → fontSize 17 (cross-platform modifier)", (await fontSize()) === 17, String(await fontSize()));

console.log("— a plain wheel (no modifier) never changes the font size —");
await wheel(-120, false, false);
await wait(60);
ok("ON but no modifier: wheel leaves fontSize at 17", (await fontSize()) === 17, String(await fontSize()));

console.log("— the change reuses the vetted clamp [11,28] —");
await setFont(28);
await wait(40);
await wheel(-120, true); // try to go past max
await wait(60);
ok("ON: Ctrl+wheel up at 28 stays clamped at 28", (await fontSize()) === 28, String(await fontSize()));
await setFont(11);
await wait(40);
await wheel(120, true); // try to go below min
await wait(60);
ok("ON: Ctrl+wheel down at 11 stays clamped at 11", (await fontSize()) === 11, String(await fontSize()));

console.log("— the toggle persists across a reload —");
ok("localStorage persisted quickFontZoom=true", (await app(() => localStorage.getItem("geode.quickFontZoom"))) === "true");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r227b", name: "r227b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await setFont(16);
await wait(60);
await wheel(-120, true);
await wait(60);
ok("after reload, ON restored → Ctrl+wheel up still changes fontSize (→17)", (await fontSize()) === 17, String(await fontSize()));

console.log("— toggle back OFF: wheel zoom disabled again —");
await toggleZoom();
await setFont(16);
await wait(40);
await wheel(-120, true);
await wait(60);
ok("back OFF: Ctrl+wheel no longer changes fontSize (stays 16)", (await fontSize()) === 16, String(await fontSize()));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR227 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
