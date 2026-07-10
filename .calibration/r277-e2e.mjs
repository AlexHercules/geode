/**
 * R277 — Settings controls pixel-polish toward Obsidian (browser :1420).
 * Run: node .calibration/r277-e2e.mjs   (dev server must be up)
 *
 * Locks the visual fidelity fixes from the pixel-level UI pass:
 *  1. Toggle switch dimensions match Obsidian's 42×24 pill with 18px thumb.
 *  2. Theme "Manage" button renders as a primary filled accent button.
 *  3. Accent color picker is a circular swatch.
 *  4. Settings modal width stays at the later screenshot-calibrated 1004px target (R286 supersedes the earlier 900px estimate).
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
await page.waitForFunction(() => !!window.geode && !!window.geode.app, null, { timeout: 15000 });

const ev = (fn) => page.evaluate(fn);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;

await page.evaluate(() => { window.__app = window.geode.app; });
await page.evaluate(() => { window.__app.workspace.openModal("settings"); });
await page.waitForSelector(tid("settings-modal"), { timeout: 5000 });
await wait(80);
await page.click(tid("settings-nav-appearance"));
await wait(80);

console.log("— (1) toggle switch matches Obsidian 42×24 pill + 18px thumb —");
// Ensure the toggle is ON so the thumb-transform assertion is deterministic.
const isOn = await ev(() => document.querySelector('[data-testid="settings-inline-title-toggle"]')?.classList.contains("is-on"));
if (!isOn) { await page.click(tid("settings-inline-title-toggle")); await wait(200); }
{
  const res = await ev(() => {
    const toggle = document.querySelector('[data-testid="settings-inline-title-toggle"]');
    if (!toggle) return null;
    const thumb = toggle.querySelector(".settings-toggle-thumb");
    const csToggle = getComputedStyle(toggle);
    const csThumb = thumb ? getComputedStyle(thumb) : null;
    return {
      toggleW: toggle.offsetWidth,
      toggleH: toggle.offsetHeight,
      thumbW: thumb ? thumb.offsetWidth : 0,
      thumbH: thumb ? thumb.offsetHeight : 0,
      toggleRadius: csToggle.borderRadius,
      thumbRadius: csThumb ? csThumb.borderRadius : "",
      on: toggle.classList.contains("is-on"),
      thumbTransform: csThumb ? csThumb.transform : "",
    };
  });
  ok("toggle rendered", !!res);
  ok("toggle width is 42px", res?.toggleW === 42, `got ${res?.toggleW}`);
  ok("toggle height is 24px", res?.toggleH === 24, `got ${res?.toggleH}`);
  ok("toggle border-radius is 12px (pill)", res?.toggleRadius === "12px", `got ${res?.toggleRadius}`);
  ok("thumb width is 18px", res?.thumbW === 18, `got ${res?.thumbW}`);
  ok("thumb height is 18px", res?.thumbH === 18, `got ${res?.thumbH}`);
  ok("thumb is circular", res?.thumbRadius === "50%", `got ${res?.thumbRadius}`);
  ok("ON toggle thumb translated 18px", res?.on && /matrix\(1, 0, 0, 1, 18,/.test(res?.thumbTransform), `transform=${res?.thumbTransform}`);
}

console.log("— (2) theme Manage button is a primary filled accent button —");
{
  const res = await ev(() => {
    const btn = document.querySelector('[data-testid="settings-theme-manage"]');
    if (!btn) return null;
    const cs = getComputedStyle(btn);
    const probe = document.createElement("div");
    probe.style.background = "var(--accent)";
    document.body.appendChild(probe);
    const accentRgb = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      bg: cs.backgroundColor,
      color: cs.color,
      border: cs.borderColor,
      accentRgb,
      isPrimaryClass: btn.classList.contains("is-primary"),
    };
  });
  ok("theme manage button rendered", !!res);
  ok("button carries is-primary class", res?.isPrimaryClass);
  // The disabled primary still keeps accent background; opacity dims it.
  // Compare against the computed --accent color via a temporary probe element.
  ok("primary button background uses accent", res?.bg === res?.accentRgb, `bg=${res?.bg} accent=${res?.accentRgb}`);
}

console.log("— (3) accent color picker is a circular swatch —");
{
  const res = await ev(() => {
    const input = document.querySelector('[data-testid="settings-accent-color"]');
    if (!input) return null;
    const cs = getComputedStyle(input);
    return {
      w: input.offsetWidth,
      h: input.offsetHeight,
      radius: cs.borderRadius,
    };
  });
  ok("accent color input rendered", !!res);
  ok("swatch is square", res?.w === res?.h, `${res?.w}x${res?.h}`);
  ok("swatch is circular (border-radius 50%)", res?.radius === "50%", `got ${res?.radius}`);
}

console.log("— (4) settings modal keeps screenshot-calibrated 1004px width —");
{
  const w = await ev(() => document.querySelector('[data-testid="settings-modal"]')?.offsetWidth);
  ok("modal width near 1004px target", w >= 1000 && w <= 1008, `got ${w}`);
}

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR277 e2e: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
