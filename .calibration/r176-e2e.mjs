/**
 * R176 — Tier 8 D13 surface: Setting.addColorPicker(cb) + ColorComponent
 * (getValue/getValueRgb/getValueHsl + setValue/setValueRgb/setValueHsl + onChange) — browser :1420.
 * Run: node .calibration/r176-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 176 additions" (Tier 8, D13).
 *
 * The fixture plugin (?obsfixture=1) runs a synchronous IIFE in onload that builds a
 * Setting().addColorPicker(...), drives the ColorComponent, and JSON-stringifies the
 * results into <div data-testid="fixture-d13color-results">.
 * Asserted here:
 *   addColorPicker renders a native <input type=color> (the old stub silently dropped it)
 *   callback receives a ColorComponent instance
 *   setValue("#ff0000") → getValue "#ff0000" / getValueRgb {255,0,0} / getValueHsl {0,100,50}
 *   setValue is SILENT (does NOT fire onChange) — frozen ValueComponent invariant
 *   setValueRgb {0,255,0} → hex "#00ff00" / hsl {120,100,50}
 *   setValueHsl {240,100,50} → hex "#0000ff" / rgb {0,0,255}
 *   the input's native 'change' event DOES fire onChange (once) with the new hex
 *   setDisabled(true) reflects onto the native input's .disabled
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
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto(BASE_URL + "?obsfixture=1");
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });

console.log("— wait for the D13 IIFE to write results —");
await page.waitForFunction(() => {
  const el = document.querySelector("[data-testid=fixture-d13color-results]");
  return el && el.textContent.length > 0;
}, null, { timeout: 10000 });

const raw = await page.locator("[data-testid=fixture-d13color-results]").textContent();
let out;
try {
  out = JSON.parse(raw);
} catch (e) {
  out = null;
  ok("results div parses as JSON", false, `raw=${raw} err=${String(e)}`);
}
out = out ?? {};

console.log("— no exception inside the IIFE —");
ok("IIFE completed without throwing (out.ok)", out.ok === true, `error=${out.error ?? ""}`);

console.log("— control rendered + ColorComponent instance —");
ok("addColorPicker renders a native <input type=color>", out.inputRendered === true, `got=${JSON.stringify(out.inputRendered)}`);
ok("callback receives a ColorComponent", out.isColorComponent === true, `got=${JSON.stringify(out.isColorComponent)}`);

console.log("— setValue(hex) → getValue / getValueRgb / getValueHsl —");
ok("getValue() === '#ff0000'", out.hex === "#ff0000", `got=${JSON.stringify(out.hex)}`);
ok("getValueRgb() === {255,0,0}", eq(out.rgb, { r: 255, g: 0, b: 0 }), `got=${JSON.stringify(out.rgb)}`);
ok("getValueHsl() === {0,100,50}", eq(out.hsl, { h: 0, s: 100, l: 50 }), `got=${JSON.stringify(out.hsl)}`);

console.log("— setValue must NOT fire onChange (frozen invariant) —");
ok("setValue did not fire onChange", out.setValueDidNotFire === true, `got=${JSON.stringify(out.setValueDidNotFire)}`);

console.log("— setValueRgb round-trip —");
ok("setValueRgb({0,255,0}) → getValue '#00ff00'", out.hexFromRgb === "#00ff00", `got=${JSON.stringify(out.hexFromRgb)}`);
ok("→ getValueHsl {120,100,50}", eq(out.hslFromRgb, { h: 120, s: 100, l: 50 }), `got=${JSON.stringify(out.hslFromRgb)}`);

console.log("— setValueHsl round-trip —");
ok("setValueHsl({240,100,50}) → getValue '#0000ff'", out.hexFromHsl === "#0000ff", `got=${JSON.stringify(out.hexFromHsl)}`);
ok("→ getValueRgb {0,0,255}", eq(out.rgbFromHsl, { r: 0, g: 0, b: 255 }), `got=${JSON.stringify(out.rgbFromHsl)}`);

console.log("— native 'change' fires onChange (user interaction) —");
ok("input 'change' fired onChange exactly once", out.changeFiresOnInput === true, `got=${JSON.stringify(out.changeFiresOnInput)}`);
ok("onChange received '#123456'", out.changeValue === "#123456", `got=${JSON.stringify(out.changeValue)}`);

console.log("— setDisabled reflects onto the input —");
ok("setDisabled(true) → input.disabled === true", out.disabledReflected === true, `got=${JSON.stringify(out.disabledReflected)}`);

console.log("— regression: fixture plugin still enabled —");
const fixtureReport = await page.evaluate(() =>
  window.geode.app.obsidianLoadReport.get().find((r) => r.id === "geode-compat-fixture") ?? null);
ok("fixture plugin status 'enabled'", fixtureReport?.status === "enabled",
  `status=${fixtureReport?.status} detail=${fixtureReport?.detail ?? ""}`);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR176: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
