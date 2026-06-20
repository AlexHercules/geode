/**
 * R129 compat App.loadLocalStorage / saveLocalStorage / isDarkMode E2E — browser mode :1420.
 * Run: node .calibration/r129-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 129 additions" (compat 商业主轴).
 *
 * Obsidian: loadLocalStorage(key)/saveLocalStorage(key, data) = per-vault localStorage (null clears);
 * isDarkMode() = whether the active theme is dark. Plugins store per-vault UI state + theme their UI.
 * Geode: JSON round-trip, keys namespaced by vault name; isDarkMode reads the resident body class.
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r129", name: "r129", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.app && typeof window.app.loadLocalStorage === "function", null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);

console.log("— loadLocalStorage / saveLocalStorage round-trip (JSON, per-vault) —");
const ls = await app(() => {
  const a = window.app;
  a.saveLocalStorage("r129str", "hello");
  a.saveLocalStorage("r129num", 42);
  a.saveLocalStorage("r129obj", { x: 1, y: [2, 3] });
  const out = {
    str: a.loadLocalStorage("r129str"),
    num: a.loadLocalStorage("r129num"),
    obj: a.loadLocalStorage("r129obj"),
    missing: a.loadLocalStorage("r129nope"),
  };
  a.saveLocalStorage("r129str", null); // clear
  out.cleared = a.loadLocalStorage("r129str");
  const vaultName = a.vault.getName();
  out.namespaced = localStorage.getItem(`geode-ls:${encodeURIComponent(vaultName)}:r129num`) !== null;
  out.notBareKey = localStorage.getItem("r129num") === null; // NOT stored under the bare key
  // a `:` in the key must not blur the namespace delimiter (encodeURIComponent both parts)
  a.saveLocalStorage("a:b", "colon");
  a.saveLocalStorage("a", "plain");
  out.colonIndependent = a.loadLocalStorage("a:b") === "colon" && a.loadLocalStorage("a") === "plain";
  return out;
});
ok("round-trips a string", ls.str === "hello", JSON.stringify(ls.str));
ok("round-trips a number", ls.num === 42, JSON.stringify(ls.num));
ok("round-trips an object (deep)", eq(ls.obj, { x: 1, y: [2, 3] }), JSON.stringify(ls.obj));
ok("a missing key → null", ls.missing === null, JSON.stringify(ls.missing));
ok("saveLocalStorage(key, null) clears the entry → null", ls.cleared === null, JSON.stringify(ls.cleared));
ok("keys are vault-namespaced (geode-ls:<vault>:key)", ls.namespaced === true);
ok("NOT stored under the bare key (no global leakage)", ls.notBareKey === true);
ok("a `:` in the key doesn't collide with a sibling key (both parts encoded)", ls.colonIndependent === true);

console.log("— isDarkMode() reads the active theme —");
const theme = await app(() => {
  const a = window.app;
  const had = { dark: document.body.classList.contains("theme-dark"), light: document.body.classList.contains("theme-light") };
  document.body.classList.remove("theme-light"); document.body.classList.add("theme-dark");
  const isDark = a.isDarkMode();
  document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light");
  const isLight = a.isDarkMode();
  // restore
  document.body.classList.toggle("theme-dark", had.dark); document.body.classList.toggle("theme-light", had.light);
  return { isDark, isLight };
});
ok("isDarkMode() === true when body has .theme-dark", theme.isDark === true);
ok("isDarkMode() === false when body has .theme-light", theme.isLight === false);

console.log("— a fresh load reads back the persisted value (survives reload) —");
await app(() => window.app.saveLocalStorage("r129persist", { keep: "me" }));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r129b", name: "r129b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.app && typeof window.app.loadLocalStorage === "function", null, { timeout: 5000 });
const afterReload = await app(() => window.app.loadLocalStorage("r129persist"));
ok("a saved value survives a reload (real localStorage persistence)", eq(afterReload, { keep: "me" }), JSON.stringify(afterReload));

console.log(`\nR129 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
