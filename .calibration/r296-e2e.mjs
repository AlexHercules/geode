/**
 * R296 core-plugin wave-2 (workspace + discovery entries) E2E - browser :1420.
 * Run: node .calibration/r296-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 296 additions".
 *
 * Applies the R294 toggle contract to wave-2: File explorer / Search / Quick
 * switcher / Command palette / Workspaces. Each is a real builtin plugin; the
 * settings toggle genuinely controls it - panel/tab/ribbon/empty-state entry
 * points hide and the open command is auto-disposed on disable, restored on
 * enable, persisted across reload. CRITICAL: lock-out safety - disabling the
 * command palette must NOT remove app:open-settings (Mod+,) or the ribbon gear,
 * so the user can always reach Settings to re-enable.
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
    const raw = localStorage.getItem("geode.plugins.enabled.v1");
    const map = raw ? JSON.parse(raw) : {};
    for (const id of ["file-explorer", "search", "quick-switcher", "command-palette", "workspaces", "tags", "outline", "outgoing-links", "backlinks", "graph"]) delete map[id];
    localStorage.setItem("geode.plugins.enabled.v1", JSON.stringify(map));
    localStorage.setItem("geode.locale", "en");
  } catch {}
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r296", name: "r296", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cmdInPalette = (id) => app((cid) => window.__app.commands.list().some((c) => c.id === cid), id);
const closeSettings = async () => { await app(() => window.__app.workspace.closeModal()); await wait(50); };
const openCorePlugins = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.waitForSelector("[data-testid=settings-modal]", { timeout: 3000 });
  await page.click("[data-testid=settings-nav-core-plugins]");
  await page.waitForSelector("[data-testid=core-plugin-toggle-workspaces]", { timeout: 3000 });
};
const toggle = async (rowId, enable) => {
  await openCorePlugins();
  const isOn = await page.$eval(`[data-testid=core-plugin-toggle-${rowId}]`, (b) => b.classList.contains("is-on"));
  if ((enable && !isOn) || (!enable && isOn)) {
    await page.click(`[data-testid=core-plugin-toggle-${rowId}]`);
    await wait(60);
  }
  await closeSettings();
};
const enabledMap = () => app(() => { try { return JSON.parse(localStorage.getItem("geode.plugins.enabled.v1") ?? "{}"); } catch { return {}; } });
// whether a button with the given text exists inside the empty-state actions
const emptyBtn = (text) => app((t) => {
  const btns = Array.from(document.querySelectorAll("[data-testid=empty-state] .empty-actions button"));
  return btns.some((b) => (b.textContent ?? "").includes(t));
}, text);
const emptyVisible = () => app(() => !!document.querySelector("[data-testid=empty-state]"));

console.log("- default ON: entry points present -");
ok("file-explorer: enabled by default", await app(() => window.geode.app.plugins.isEnabled("file-explorer")));
ok("file-explorer: left-tab-explorer visible", await page.$("[data-testid=left-tab-explorer]") !== null);
ok("file-explorer: app:show-file-explorer in palette", await cmdInPalette("app:show-file-explorer"));
ok("search: enabled by default", await app(() => window.geode.app.plugins.isEnabled("search")));
ok("search: left-tab-search visible", await page.$("[data-testid=left-tab-search]") !== null);
ok("search: app:show-search in palette", await cmdInPalette("app:show-search"));
ok("quick-switcher: enabled by default", await app(() => window.geode.app.plugins.isEnabled("quick-switcher")));
ok("quick-switcher: app:quick-switcher in palette", await cmdInPalette("app:quick-switcher"));
ok("quick-switcher: empty-state switcher button visible", (await emptyVisible()) ? await emptyBtn("quick switcher") : true);
ok("command-palette: enabled by default", await app(() => window.geode.app.plugins.isEnabled("command-palette")));
ok("command-palette: app:command-palette in palette", await cmdInPalette("app:command-palette"));
ok("command-palette: ribbon palette button visible", await page.$('.ribbon-btn[aria-label="Command palette (Ctrl+P)"]') !== null);
ok("workspaces: enabled by default", await app(() => window.geode.app.plugins.isEnabled("workspaces")));
ok("workspaces: workspace:manage in palette", await cmdInPalette("workspace:manage"));

console.log("- lock-out safety baseline -");
ok("app:open-settings in registry (Mod+,)", await cmdInPalette("app:open-settings"));
ok("ribbon settings gear visible", await page.$('[data-testid=sidebar-footer-settings]') !== null);

console.log("- disable each wave-2 feature -");
await toggle("file-explorer", false);
ok("file-explorer: disabled", await app(() => !window.geode.app.plugins.isEnabled("file-explorer")));
ok("file-explorer: left-tab-explorer hidden", await page.$("[data-testid=left-tab-explorer]") === null);
ok("file-explorer: app:show-file-explorer gone", !(await cmdInPalette("app:show-file-explorer")));
// explorer default-fallback: leftPanel="explorer" -> SearchPanel renders (not Explorer)
await app(() => { window.__app.workspace.setLeftPanel("explorer"); });
await wait(80);
ok("file-explorer disabled + leftPanel=explorer -> Explorer absent (fallback)", await page.$("[data-testid=explorer]") === null);
ok("file-explorer disabled + leftPanel=explorer -> SearchPanel renders (fallback)", await page.$("[data-testid=search-panel]") !== null);

await toggle("search", false);
ok("search: disabled", await app(() => !window.geode.app.plugins.isEnabled("search")));
ok("search: left-tab-search hidden", await page.$("[data-testid=left-tab-search]") === null);
ok("search: app:show-search gone", !(await cmdInPalette("app:show-search")));
// both explorer + search disabled -> leftPanel falls to bookmarks
await app(() => { window.__app.workspace.setLeftPanel("explorer"); });
await wait(80);
ok("explorer+search disabled + leftPanel=explorer -> BookmarksPanel renders (final fallback)", await page.$("[data-testid=bookmarks-panel]") !== null);

await toggle("quick-switcher", false);
ok("quick-switcher: disabled", await app(() => !window.geode.app.plugins.isEnabled("quick-switcher")));
ok("quick-switcher: app:quick-switcher gone", !(await cmdInPalette("app:quick-switcher")));
ok("quick-switcher: empty-state switcher button hidden", (await emptyVisible()) ? !(await emptyBtn("quick switcher")) : true);

await toggle("command-palette", false);
ok("command-palette: disabled", await app(() => !window.geode.app.plugins.isEnabled("command-palette")));
ok("command-palette: app:command-palette gone", !(await cmdInPalette("app:command-palette")));
ok("command-palette: ribbon palette button hidden", await page.$('.ribbon-btn[aria-label="Command palette (Ctrl+P)"]') === null);

await toggle("workspaces", false);
ok("workspaces: disabled", await app(() => !window.geode.app.plugins.isEnabled("workspaces")));
ok("workspaces: workspace:manage gone", !(await cmdInPalette("workspace:manage")));

console.log("- lock-out safety: command-palette disabled -> settings still reachable -");
ok("app:open-settings STILL in registry with command-palette disabled", await cmdInPalette("app:open-settings"));
ok("ribbon settings gear STILL visible with command-palette disabled", await page.$('[data-testid=sidebar-footer-settings]') !== null);
// actually open settings via the app:open-settings command (simulates Mod+,)
await app(() => window.__app.commands.execute("app:open-settings"));
await page.waitForSelector("[data-testid=settings-modal]", { timeout: 3000 });
ok("app:open-settings opens settings modal (Mod+, works)", true);
await closeSettings();

console.log("- re-enable all -");
for (const id of ["file-explorer", "search", "quick-switcher", "command-palette", "workspaces"]) {
  await toggle(id, true);
  ok(`${id}: re-enabled`, await app((pid) => window.geode.app.plugins.isEnabled(pid), id));
}
ok("file-explorer re-enabled: left-tab-explorer back", await page.$("[data-testid=left-tab-explorer]") !== null);
ok("command-palette re-enabled: ribbon palette button back", await page.$('.ribbon-btn[aria-label="Command palette (Ctrl+P)"]') !== null);
ok("command-palette re-enabled: app:command-palette back", await cmdInPalette("app:command-palette"));

console.log("- F1 lock: editor:merge-file respects quick-switcher gate -");
// merge-file opens the switcher; its available() must be false when quick-switcher
// is disabled (the palette filters on available()). list() itself is unfiltered.
const mergeAvailable = () => app(() => {
  const cmd = window.__app.commands.list().find((c) => c.id === "editor:merge-file");
  return cmd && cmd.available ? cmd.available() : true;
});
await app(async () => {
  try { await window.__app.vault.create("r296-merge.md", "# x\n"); } catch {}
  window.__app.workspace.openFile("r296-merge.md");
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
ok("merge-file available with quick-switcher enabled + active file", await mergeAvailable());
await toggle("quick-switcher", false);
ok("merge-file NOT available with quick-switcher disabled (F1 fix)", !(await mergeAvailable()));
await toggle("quick-switcher", true);
ok("merge-file available after quick-switcher re-enable", await mergeAvailable());

console.log("- restart persistence (file-explorer + command-palette) -");
await app(() => window.geode.app.plugins.disable("file-explorer"));
await app(() => window.geode.app.plugins.disable("command-palette"));
await wait(60);
const m1 = await enabledMap();
ok("file-explorer:false + command-palette:false persisted", m1["file-explorer"] === false && m1["command-palette"] === false);
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r296", name: "r296", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
ok("file-explorer stays disabled after reload", await app(() => !window.geode.app.plugins.isEnabled("file-explorer")));
ok("command-palette stays disabled after reload", await app(() => !window.geode.app.plugins.isEnabled("command-palette")));
ok("app:open-settings still in registry after reload (lock-out safe)", await cmdInPalette("app:open-settings"));
ok("file-explorer tab hidden after reload", await page.$("[data-testid=left-tab-explorer]") === null);
// restore defaults for subsequent suites
for (const id of ["file-explorer", "command-palette"]) await app((pid) => window.geode.app.plugins.enable(pid, { userAction: true }), id);
await wait(50);

console.log("- catalog: 5 wave-2 rows now have operable toggles -");
await openCorePlugins();
for (const id of ["file-explorer", "search", "quick-switcher", "command-palette", "workspaces"]) {
  ok(`toggle operable: ${id}`, await page.$eval(`[data-testid=core-plugin-toggle-${id}]`, (b) => !b.disabled));
}
await closeSettings();

console.log(`\n${passed} passed, ${failed} failed`);
if (pageErrors.length) console.log("page errors:\n" + pageErrors.join("\n"));
await browser.close();
if (failed > 0) process.exit(1);
