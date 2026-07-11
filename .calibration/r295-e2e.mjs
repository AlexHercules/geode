/**
 * R295 core-plugin wave-1 (Backlinks/Outgoing links/Outline/Graph) E2E - browser :1420.
 * Run: node .calibration/r295-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 295 additions".
 *
 * Applies the R294 toggle contract to the four wave-1 sidebar knowledge views.
 * Each is now a real builtin plugin: the settings toggle genuinely controls it -
 * sidebar tab + render switch + effectiveRight fallback + commands all hide/remove
 * on disable and restore on enable, persisted across reload. Graph (main-area only)
 * gates the ribbon + empty-state button + the singleton-view renderTab (inert
 * placeholder when disabled). Backlinks is the default right-panel fallback, so
 * disabling it falls the render to Calendar.
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
// clear any persisted disabled flags from prior runs
await page.evaluate(() => {
  try {
    const raw = localStorage.getItem("geode.plugins.enabled.v1");
    const map = raw ? JSON.parse(raw) : {};
    for (const id of ["outline", "outgoing-links", "backlinks", "graph", "tags"]) delete map[id];
    localStorage.setItem("geode.plugins.enabled.v1", JSON.stringify(map));
    localStorage.setItem("geode.locale", "en");
  } catch {}
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r295", name: "r295", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cmdInPalette = (id) => app((cid) => window.__app.commands.list().some((c) => c.id === cid), id);
const closeSettings = async () => { await app(() => window.__app.workspace.closeModal()); await wait(50); };
const openCorePlugins = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.waitForSelector("[data-testid=settings-modal]", { timeout: 3000 });
  await page.click("[data-testid=settings-nav-core-plugins]");
  await page.waitForSelector("[data-testid=core-plugin-toggle-graph]", { timeout: 3000 });
};
// toggle a core plugin via the settings UI; enable=true turns it on, false off
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

// sidebar-panel features: outline / outgoing-links / backlinks
const panelFeatures = [
  { rowId: "outline", pluginId: "outline", tab: "right-tab-outline", panel: "outline-panel", cmds: ["app:show-outline", "outline:open-outline"], rightPanel: "outline" },
  { rowId: "outgoing-links", pluginId: "outgoing-links", tab: "right-tab-outgoinglinks", panel: null, cmds: ["app:show-outgoing-links", "outgoing-links:open-outgoing-links"], rightPanel: "outgoinglinks" },
  { rowId: "backlinks", pluginId: "backlinks", tab: "right-tab-backlinks", panel: "backlinks-panel", cmds: ["app:show-backlinks", "backlink:open-backlinks"], rightPanel: "backlinks" },
];

console.log("- sidebar-panel features: default ON -");
for (const f of panelFeatures) {
  ok(`${f.rowId}: enabled by default`, await app((id) => window.geode.app.plugins.isEnabled(id), f.pluginId));
  ok(`${f.rowId}: sidebar tab visible`, await page.$(`[data-testid=${f.tab}]`) !== null);
  for (const c of f.cmds) ok(`${f.rowId}: command ${c} in palette`, await cmdInPalette(c));
}

console.log("- disable each sidebar-panel feature -");
for (const f of panelFeatures) {
  await toggle(f.rowId, false);
  ok(`${f.rowId}: disabled`, await app((id) => !window.geode.app.plugins.isEnabled(id), f.pluginId));
  ok(`${f.rowId}: tab hidden`, await page.$(`[data-testid=${f.tab}]`) === null);
  for (const c of f.cmds) ok(`${f.rowId}: command ${c} gone`, !(await cmdInPalette(c)));
  // render fallback: select the panel, assert it does NOT render
  await app((rp) => { window.__app.workspace.setRightPanel(rp); }, f.rightPanel);
  await wait(60);
  if (f.panel) ok(`${f.rowId}: panel not rendered when disabled`, await page.$(`[data-testid=${f.panel}]`) === null);
  // ws.rightPanel not mutated
  ok(`${f.rowId}: ws.rightPanel not mutated`, (await app((rp) => window.__app.workspace.state.get().rightPanel, f.rightPanel)) === f.rightPanel);
}

console.log("- backlinks default-fallback: disabled -> Calendar -");
// backlinks is disabled from the loop above; rightPanel="backlinks" should render Calendar
await app(() => { window.__app.workspace.setRightPanel("backlinks"); });
await wait(80);
ok("backlinks disabled + rightPanel=backlinks -> CalendarPanel renders (fallback)", await page.$("[data-testid=calendar-panel]") !== null);
ok("backlinks disabled + rightPanel=backlinks -> BacklinksPanel absent", await page.$("[data-testid=backlinks-panel]") === null);

console.log("- re-enable sidebar-panel features -");
for (const f of panelFeatures) {
  await toggle(f.rowId, true);
  ok(`${f.rowId}: re-enabled`, await app((id) => window.geode.app.plugins.isEnabled(id), f.pluginId));
  ok(`${f.rowId}: tab visible again`, await page.$(`[data-testid=${f.tab}]`) !== null);
  for (const c of f.cmds) ok(`${f.rowId}: command ${c} back`, await cmdInPalette(c));
}

console.log("- graph (main-area only): ribbon + commands + singleton placeholder -");
ok("graph: enabled by default", await app(() => window.geode.app.plugins.isEnabled("graph")));
ok("graph: ribbon button visible", await page.$('.ribbon-btn[aria-label="Graph view (Ctrl+G)"]') !== null);
// open a graph main-area tab, assert GraphView renders
await app(() => window.geode.app.workspace.openGraph());
await page.waitForSelector("[data-testid=graph-view]", { timeout: 4000 });
ok("graph: open graph tab -> GraphView renders", await page.$("[data-testid=graph-view]") !== null);
ok("graph: app:open-graph + graph:open-local in palette", await cmdInPalette("app:open-graph") && await cmdInPalette("graph:open-local"));
// disable graph -> singleton placeholder
await toggle("graph", false);
ok("graph: disabled", await app(() => !window.geode.app.plugins.isEnabled("graph")));
ok("graph: app:open-graph gone", !(await cmdInPalette("app:open-graph")));
ok("graph: graph:open-local gone", !(await cmdInPalette("graph:open-local")));
ok("graph: ribbon button hidden when disabled", await page.$('.ribbon-btn[aria-label="Graph view (Ctrl+G)"]') === null);
ok("graph: GraphView replaced by inert placeholder", await page.$(".main-view-disabled") !== null && await page.$("[data-testid=graph-view]") === null);
// re-enable -> GraphView restores (the graph tab is still open)
await toggle("graph", true);
ok("graph: re-enabled -> GraphView restores", await page.$("[data-testid=graph-view]") !== null);

console.log("- restart persistence (outline + graph) -");
await app(() => window.geode.app.plugins.disable("outline"));
await app(() => window.geode.app.plugins.disable("graph"));
await wait(60);
const m1 = await enabledMap();
ok("outline:false + graph:false persisted", m1.outline === false && m1.graph === false);
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r295", name: "r295", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
ok("outline stays disabled after reload", await app(() => !window.geode.app.plugins.isEnabled("outline")));
ok("graph stays disabled after reload", await app(() => !window.geode.app.plugins.isEnabled("graph")));
ok("outline tab hidden after reload", await page.$("[data-testid=right-tab-outline]") === null);
ok("graph:open-local absent after reload", !(await cmdInPalette("graph:open-local")));
// restore default-on for subsequent suites
await app(() => window.geode.app.plugins.enable("outline", { userAction: true }));
await app(() => window.geode.app.plugins.enable("graph", { userAction: true }));
await wait(50);

console.log("- catalog: 4 wave-1 rows now have operable toggles -");
await openCorePlugins();
for (const id of ["outline", "outgoing-links", "backlinks", "graph"]) {
  ok(`toggle operable: ${id}`, await page.$eval(`[data-testid=core-plugin-toggle-${id}]`, (b) => !b.disabled));
}
await closeSettings();

console.log(`\n${passed} passed, ${failed} failed`);
if (pageErrors.length) console.log("page errors:\n" + pageErrors.join("\n"));
await browser.close();
if (failed > 0) process.exit(1);
