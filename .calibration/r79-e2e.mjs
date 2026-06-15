/**
 * R79 appearance E2E — accent color + system theme tri-state — browser mode :1420.
 * Run: node .calibration/r79-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 79 additions" (㊺).
 *
 * Covers resolveTheme truth table + accent override/persist/reset (via
 * __geodeAppearance) AND the live behaviour: "system" theme follows
 * prefers-color-scheme (emulateMedia), explicit dark/light override it, and the
 * settings panel exposes the 3 theme buttons + accent picker.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r79", name: "r79", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeAppearance?.resolveTheme, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const resolve = (kind, dark) => app(([k, d]) => window.__geodeAppearance.resolveTheme(k, d), [kind, dark]);
const dataset = () => app(() => document.documentElement.dataset.theme);
const accentVar = () => app(() => document.documentElement.style.getPropertyValue("--accent"));
const ls = (key) => app(([k]) => { try { return localStorage.getItem(k); } catch { return null; } }, [key]);

// ── resolveTheme truth table (probe hook) ───────────────────────────────────
console.log("— resolveTheme —");
ok("resolve(dark, *) → dark", (await resolve("dark", true)) === "dark" && (await resolve("dark", false)) === "dark");
ok("resolve(light, *) → light", (await resolve("light", true)) === "light" && (await resolve("light", false)) === "light");
ok("resolve(system, prefersDark) → dark", (await resolve("system", true)) === "dark");
ok("resolve(system, prefersLight) → light", (await resolve("system", false)) === "light");

// ── accent color override / persist / reset ─────────────────────────────────
console.log("— accent color —");
await app(() => window.__geodeAppearance.setAccent("#ff0000"));
await wait(50);
ok("setAccent → --accent = #ff0000", (await accentVar()).trim() === "#ff0000");
ok("setAccent → localStorage persisted", (await ls("geode.accentColor")) === "#ff0000");
await app(() => window.__geodeAppearance.setAccent("not-a-color"));
await wait(50);
ok("invalid color → --accent dropped (default)", (await accentVar()).trim() === "");
await app(() => window.__geodeAppearance.setAccent("#00ff00"));
await wait(50);
await app(() => window.__geodeAppearance.setAccent(""));
await wait(50);
ok("reset (\"\") → --accent removed", (await accentVar()).trim() === "");
ok("reset → localStorage cleared", (await ls("geode.accentColor")) === null);

// ── system theme follows prefers-color-scheme ───────────────────────────────
console.log("— system theme tri-state —");
await page.emulateMedia({ colorScheme: "light" });
await app(() => window.__app.workspace.setTheme("system"));
await wait(80);
ok("theme=system + media light → dataset.theme=light", (await dataset()) === "light");
await page.emulateMedia({ colorScheme: "dark" });
await wait(120);
ok("media flips to dark → dataset.theme follows to dark (watchSystemTheme)", (await dataset()) === "dark");
ok("workspace.state.theme stays 'system' (kind preserved)", await app(() => window.__app.workspace.state.get().theme === "system"));

// ── explicit theme overrides system ─────────────────────────────────────────
console.log("— explicit theme —");
await app(() => window.__app.workspace.setTheme("dark"));
await wait(50);
ok("explicit dark → dataset.theme=dark regardless of media", (await dataset()) === "dark");
await page.emulateMedia({ colorScheme: "light" });
await wait(80);
ok("media light does NOT change explicit dark", (await dataset()) === "dark");
await app(() => window.__app.workspace.setTheme("light"));
await wait(50);
ok("explicit light → dataset.theme=light", (await dataset()) === "light");

// ── settings panel exposes the controls ─────────────────────────────────────
console.log("— settings panel —");
await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 250)); });
ok("system theme button present", await app(() => !!document.querySelector('[data-testid="settings-theme-system"]')));
ok("accent color input present", await app(() => !!document.querySelector('[data-testid="settings-accent-color"]')));
ok("accent reset button present", await app(() => !!document.querySelector('[data-testid="settings-accent-reset"]')));
await page.locator('[data-testid="settings-theme-system"]').click();
await wait(80);
ok("clicking system button sets workspace theme=system", await app(() => window.__app.workspace.state.get().theme === "system"));

// ── R45 invariant holds for "system": layout never carries/changes theme ────
console.log("— R45 × system: layout excludes theme —");
await app(() => window.__app.workspace.setTheme("system"));
await wait(40);
const snapHasTheme = await app(() => {
  const snap = window.__app.workspace.captureLayout();
  return Object.prototype.hasOwnProperty.call(snap, "theme");
});
ok("captureLayout strips theme even when kind=system", snapHasTheme === false);
await app(() => {
  window.__snap = window.__app.workspace.captureLayout();
  window.__app.workspace.setTheme("dark");
  window.__app.workspace.applyLayout(window.__snap, () => true);
});
await wait(60);
ok("applyLayout keeps current theme (dark), not the snapshot's", await app(() => window.__app.workspace.state.get().theme === "dark"));

console.log(`\nR79 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
