/**
 * R279 plugin-list settings gear E2E — browser mode :1420.
 * Run: node .calibration/r279-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 279 additions".
 *
 * Obsidian's installed-community plugin list shows a gear icon on each plugin that has settings;
 * clicking it opens that plugin's settings tab. Geode already hosts per-plugin settings tabs, but
 * the list only had an uninstall button + toggle. R279 adds the gear.
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const app = (fn, arg) => page.evaluate(fn, arg);
const visible = (sel) => page.isVisible(sel);

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
// Let any in-flight HMR from recent source edits settle before pinning the app handle.
await wait(2500);

// Register all test plugins from inside a single probe plugin onload so we have a stable app
// handle and the settings section is registered before we assert.
await page.evaluate(() => {
  // Register as external plugins so they appear in the third-party plugin list.
  const registerExternal = (p) => window.geode.app.plugins.register(p, "external");
  registerExternal({
    id: "r279:with-settings",
    name: "R279 With Settings",
    version: "1.0.0",
    onload() {
      // Geode AppHandle does not expose plugins.addSettingsSection; use the host manager directly
      // so this UI test can attach a settings section to a runtime-registered plugin.
      window.geode.app.plugins.addSettingsSection({
        id: "r279-with-settings",
        pluginId: "r279:with-settings",
        name: "R279 With Settings",
        mount(el) { el.innerHTML = '<div data-testid="r279-settings-body">settings body</div>'; },
        unmount() {},
      });
    },
  });
  registerExternal({
    id: "r279:no-settings",
    name: "R279 No Settings",
    version: "1.0.0",
    onload() {},
  });
});

await wait(80);
ok("test plugins are listed", await app(() => {
  const ids = window.geode.app.plugins.list().map((p) => p.plugin.id);
  return ids.includes("r279:with-settings") && ids.includes("r279:no-settings");
}));

const openPlugins = async () => {
  await app(() => window.geode.app.workspace.openModal("settings"));
  await page.waitForSelector('[data-testid="settings-modal"]', { timeout: 3000 });
  await page.click('[data-testid="settings-nav-plugins"]');
  await page.waitForSelector('[data-testid="settings-plugin-list-external"]', { timeout: 3000 });
};

await openPlugins();

console.log("— plugin with a settings section shows a gear button —");
ok("gear visible for plugin with settings", await visible('[data-testid="plugin-settings-r279:with-settings"]'));

console.log("— clicking the gear navigates to the plugin's settings tab —");
await page.click('[data-testid="plugin-settings-r279:with-settings"]');
await wait(80);
ok("plugin tab is selected in left nav", await app(() => document.querySelector('[data-testid="settings-nav-plugin-r279-with-settings"]')?.classList.contains("is-active") ?? false));
ok("plugin settings body is mounted", await visible('[data-testid="r279-settings-body"]'));

console.log("— plugin without a settings section has no gear —");
ok("no gear for plugin without settings", !(await visible('[data-testid="plugin-settings-r279:no-settings"]')));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR279 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
