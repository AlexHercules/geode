/**
 * R159 compat app.internalPlugins daily-notes instance.options E2E — browser mode :1420.
 * Run: node .calibration/r159-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 159 additions" (compat 商业主轴).
 *
 * Obsidian (non-public) `app.internalPlugins.getPluginById("daily-notes").instance.options`:
 * { folder, format, template, autorun } — the config obsidian-daily-notes-interface reads
 * (Calendar / Periodic Notes depend on it). A live getter over R48's daily-note setting Stores.
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
await page.evaluate(() => {
  try {
    localStorage.setItem("geode.locale", "en");
    localStorage.removeItem("geode.dailyNote.folder");
    localStorage.removeItem("geode.dailyNote.format");
    localStorage.removeItem("geode.dailyNote.template");
  } catch {}
});
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.app && !!window.app.internalPlugins, null, { timeout: 15000 });
// window.app = compat app (has internalPlugins); register a plugin to capture the core app for openModal
await page.evaluate(() => window.geode.registerPlugin({ id: "r159", name: "r159", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dnOptions = () => ev(() => window.app.internalPlugins.getPluginById("daily-notes").instance.options);

console.log("— getPluginById('daily-notes') shape + default options —");
ok("getPluginById('daily-notes') → { enabled:true, instance }", await ev(() => {
  const p = window.app.internalPlugins.getPluginById("daily-notes");
  return !!p && p.enabled === true && !!p.instance && typeof p.instance.options === "object";
}));
ok("options.folder defaults to 'Daily Notes'", (await dnOptions()).folder === "Daily Notes");
ok("options.format defaults to 'YYYY-MM-DD' (moment, same lib as Obsidian)", (await dnOptions()).format === "YYYY-MM-DD");
ok("options.template defaults to ''", (await dnOptions()).template === "");
ok("options.autorun is false (Geode has no startup-open setting)", (await dnOptions()).autorun === false);

console.log("— options is a LIVE getter over the setting Stores —");
await ev(() => window.__app.workspace.openModal("settings"));
await page.waitForSelector("[data-testid=settings-daily-folder]", { timeout: 3000 });
await page.fill("[data-testid=settings-daily-folder]", "Journal/Days");
await page.fill("[data-testid=settings-daily-format]", "YYYY/MM/DD");
await wait(60);
await ev(() => window.__app.workspace.closeModal());
await wait(40);
ok("options.folder reflects the changed setting live (no reload)", (await dnOptions()).folder === "Journal/Days");
ok("options.format reflects the changed setting live", (await dnOptions()).format === "YYYY/MM/DD");

console.log("— lookup safety + plugins record consistency —");
ok("getPluginById('toString') → null (Object.hasOwn guard, no prototype member)", await ev(() => window.app.internalPlugins.getPluginById("toString") === null));
ok("getPluginById('nope') → null", await ev(() => window.app.internalPlugins.getPluginById("nope") === null));
ok("plugins['daily-notes'] === getPluginById('daily-notes') (same wrapper)", await ev(() =>
  window.app.internalPlugins.plugins["daily-notes"] === window.app.internalPlugins.getPluginById("daily-notes")));
ok("getEnabledPluginById('daily-notes') → the instance (has .options)", await ev(() => {
  const inst = window.app.internalPlugins.getEnabledPluginById("daily-notes");
  return !!inst && typeof inst.options === "object";
}));

console.log("— R158 bookmarks instance still works (record refactor is zero-regression) —");
ok("getPluginById('bookmarks').instance.getBookmarks is a function", await ev(() =>
  typeof window.app.internalPlugins.getPluginById("bookmarks").instance.getBookmarks === "function"));
ok("getBookmarks() still returns an array", await ev(() =>
  Array.isArray(window.app.internalPlugins.getPluginById("bookmarks").instance.getBookmarks())));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR159 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
