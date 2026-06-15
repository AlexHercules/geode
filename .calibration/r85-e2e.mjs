/**
 * R85 font families E2E — browser mode against dev :1420.
 * Run: node .calibration/r85-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 85 additions" (㊺).
 *
 * Covers sanitizeFontFamily (CSS-injection guard, via __geodeFontSanitize) +
 * the 3 font setters applying --font-interface/--font-text/--font-monospace +
 * persisting/clearing, and the 3 settings inputs. Pure front-end, no writes.
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
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r85", name: "r85", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeFontSanitize && !!window.__geodeAppearance, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const san = (raw) => app(([r]) => window.__geodeFontSanitize(r), [raw]);
const setFont = (which, raw) => app(([w, r]) => window.__geodeAppearance.setFont(w, r), [which, raw]);
const fontVar = (prop) => app(([p]) => window.__geodeAppearance.fontVar(p), [prop]);
const ls = (k) => app(([key]) => localStorage.getItem(key), [k]);

// ── sanitizeFontFamily (CSS-injection guard) ────────────────────────────────
console.log("— sanitizeFontFamily —");
ok("plain name kept", (await san("Inter")) === "Inter");
ok("multi-word name kept + collapsed", (await san("  JetBrains   Mono  ")) === "JetBrains Mono");
ok("quotes stripped", (await san('My "Quoted" Font')) === "My Quoted Font");
const injected = await san('Foo; } body{display:none} (<x>)');
ok("CSS-injection chars stripped (none of ;{}()<>\"' remain)", !/[;{}()<>"'\\]/.test(injected), injected);
ok("backslash stripped, newlines/tabs → spaces", (await san("A\\B\nC\tD")) === "AB C D");
ok("control chars stripped (NUL/C0/DEL), keeping a valid declaration", (await san("a\u0000b\u0007c\u007fd")) === "abcd");
ok("empty → empty", (await san("   ")) === "");

// ── setters apply the CSS vars + persist ────────────────────────────────────
console.log("— font setters apply CSS vars —");
await setFont("interface", "Inter");
await wait(60);
ok("interface font → --font-interface = \"Inter\", <stack>",
  (await fontVar("--font-interface")).startsWith('"Inter",'), await fontVar("--font-interface"));
ok("interface font persisted (sanitized)", (await ls("geode.interfaceFont")) === "Inter");

await setFont("text", "Georgia");
await wait(60);
ok("text font → --font-text set", (await fontVar("--font-text")).startsWith('"Georgia",'), await fontVar("--font-text"));

await setFont("monospace", "JetBrains Mono");
await wait(60);
ok("monospace font → --font-monospace set", (await fontVar("--font-monospace")).startsWith('"JetBrains Mono",'), await fontVar("--font-monospace"));
ok("monospace persisted", (await ls("geode.monospaceFont")) === "JetBrains Mono");

// injection attempt sanitized before hitting the CSS var
await setFont("interface", 'Evil; } body{display:none');
await wait(60);
const evilVar = await fontVar("--font-interface");
ok("injection sanitized in the applied var (no ; { })", !/[;{}]/.test(evilVar), evilVar);

// clearing → removeProperty (back to default stack)
await setFont("interface", "");
await wait(60);
ok("clearing interface font removes the override", (await fontVar("--font-interface")) === "(default)", await fontVar("--font-interface"));
ok("clearing removes the localStorage key", (await ls("geode.interfaceFont")) === null);

// ── settings panel exposes the 3 font inputs ────────────────────────────────
console.log("— settings panel —");
await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 250)); });
ok("interface font input present", await app(() => !!document.querySelector('[data-testid="settings-font-interface"]')));
ok("text font input present", await app(() => !!document.querySelector('[data-testid="settings-font-text"]')));
ok("monospace font input present", await app(() => !!document.querySelector('[data-testid="settings-font-monospace"]')));
// typing in the input applies the var + persists
await page.fill('[data-testid="settings-font-monospace"]', "Fira Code");
await wait(120);
ok("typing the monospace input applies the var", (await fontVar("--font-monospace")).startsWith('"Fira Code",'), await fontVar("--font-monospace"));
ok("typing persists to localStorage", (await ls("geode.monospaceFont")) === "Fira Code");
// clear the input → override removed
await page.fill('[data-testid="settings-font-monospace"]', "");
await wait(120);
ok("clearing the input removes the monospace override", (await fontVar("--font-monospace")) === "(default)", await fontVar("--font-monospace"));

console.log(`\nR85 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
