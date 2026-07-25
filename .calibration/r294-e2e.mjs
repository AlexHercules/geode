/**
 * R294 core-plugin real toggle contract + Tags vertical slice E2E - browser mode :1420.
 * Run: node .calibration/r294-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 294 additions".
 *
 * R293 GAP_AUDIT: CORE_PLUGIN_ROWS had 21 rows but only 4 bound to a real pluginId;
 * the rest showed disabled (greyed) toggles over always-on features. R294 freezes the
 * core-plugin manifest/lifecycle/entry-gate contract, completes the 1.9.10 catalog,
 * and proves the contract with a Tags vertical slice: toggling the Tags core plugin off
 * hides the sidebar tab, falls the render back to backlinks (without mutating
 * ws.rightPanel), removes the "Show tags" command from the palette, and persists across
 * reload; re-enable restores everything. Also asserts the 8 new catalog rows exist and
 * that always-on (not-yet-pluginified) rows keep an honest disabled toggle.
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
// ensure tags is enabled (clear any persisted disabled flag from a prior run)
await page.evaluate(() => {
  try {
    const raw = localStorage.getItem("geode.plugins.enabled.v1");
    const map = raw ? JSON.parse(raw) : {};
    delete map.tags;
    localStorage.setItem("geode.plugins.enabled.v1", JSON.stringify(map));
    localStorage.setItem("geode.locale", "en");
  } catch {}
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r294", name: "r294", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cmdInPalette = (id) => app((cid) => window.__app.commands.list().some((c) => c.id === cid), id);
const enabledMap = () => app(() => { try { return JSON.parse(localStorage.getItem("geode.plugins.enabled.v1") ?? "{}"); } catch { return {}; } });
const closeSettings = async () => { await app(() => window.__app.workspace.closeModal()); await wait(60); };
const openCorePlugins = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.waitForSelector("[data-testid=settings-modal]", { timeout: 3000 });
  await page.click("[data-testid=settings-nav-core-plugins]");
  await page.waitForSelector("[data-testid=core-plugin-toggle-tags]", { timeout: 3000 });
};

console.log("- Tags core plugin: default ON -");
ok("tags plugin registered + enabled by default", await app(() => window.geode.app.plugins.isEnabled("tags")));
ok("tags sidebar tab visible (default ON)", await page.$("[data-testid=right-tab-tags]") !== null);
ok("app:show-tags command in palette (default ON)", await cmdInPalette("app:show-tags"));

console.log("- disable Tags via settings toggle -");
// select tags so rightPanel="tags", then disable and assert render falls back without mutation
await app(() => { window.__app.workspace.setRightPanel("tags"); });
await page.waitForSelector("[data-testid=tags-panel]", { timeout: 4000 });
await openCorePlugins();
ok("tags toggle is operable (wired, not disabled)", await page.$eval("[data-testid=core-plugin-toggle-tags]", (b) => !b.disabled));
const rpBefore = await app(() => window.__app.workspace.state.get().rightPanel);
await page.click("[data-testid=core-plugin-toggle-tags]");
await wait(80);
ok("tags plugin now disabled", await app(() => !window.geode.app.plugins.isEnabled("tags")));
ok("tags sidebar tab hidden after disable", await page.$("[data-testid=right-tab-tags]") === null);
ok("app:show-tags command removed from palette after disable", !(await cmdInPalette("app:show-tags")));
ok("ws.rightPanel NOT mutated on disable (still 'tags')", (await app(() => window.__app.workspace.state.get().rightPanel)) === "tags");
await closeSettings();
ok("TagsPanel not rendered when disabled (render falls back to backlinks)", await page.$("[data-testid=tags-panel]") === null);

console.log("- re-enable Tags via settings toggle -");
await openCorePlugins();
await page.click("[data-testid=core-plugin-toggle-tags]");
await wait(80);
ok("tags plugin re-enabled", await app(() => window.geode.app.plugins.isEnabled("tags")));
ok("tags sidebar tab visible after re-enable", await page.$("[data-testid=right-tab-tags]") !== null);
ok("app:show-tags command back in palette after re-enable", await cmdInPalette("app:show-tags"));
await closeSettings();
// rightPanel was preserved as "tags" -> TagsPanel renders again now that it's enabled
ok("TagsPanel renders again after re-enable (rightPanel was preserved)", await page.$("[data-testid=tags-panel]") !== null);

console.log("- restart persistence -");
await app(() => window.geode.app.plugins.disable("tags"));
await wait(60);
const m1 = await enabledMap();
ok("disabled flag persisted to localStorage (tags:false)", m1.tags === false);
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r294", name: "r294", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
ok("tags stays disabled after reload (persistence)", await app(() => !window.geode.app.plugins.isEnabled("tags")));
ok("tags tab hidden after reload", await page.$("[data-testid=right-tab-tags]") === null);
ok("app:show-tags command absent after reload", !(await cmdInPalette("app:show-tags")));
// restore default-on state for any subsequent suites
await app(() => window.geode.app.plugins.enable("tags", { userAction: true }));
await wait(60);
ok("tags re-enabled after reload (restored)", await app(() => window.geode.app.plugins.isEnabled("tags")));

console.log("- 1.9.10 catalog completion (8 new rows) -");
await openCorePlugins();
const newRowIds = ["search","bookmarks","properties-view","footnotes-view","bases","web-clipper","markdown-converter","sync"];
for (const id of newRowIds) {
  ok(`catalog row present: ${id}`, await page.$(`[data-testid=core-plugin-${id}]`) !== null);
}
// not-yet-built feature rows keep an honest disabled toggle (no plugin backs them).
// R296 promoted search; R297 promoted bookmarks/properties-view/footnotes-view
// (plus templates/file-recovery/note-composer/page-preview) to real plugins, so the
// remaining disabled-toggle rows are the 缺 (not-built) features.
const alwaysOnIds = ["canvas","slides","audio-recorder","bases","web-clipper","markdown-converter"];
for (const id of alwaysOnIds) {
  ok(`not-built row toggle disabled (no plugin yet): ${id}`, await page.$eval(`[data-testid=core-plugin-toggle-${id}]`, (b) => b.disabled));
}
// contrast: the wired tags toggle is operable
ok("tags toggle operable (contrast with not-yet-pluginified rows)", await page.$eval("[data-testid=core-plugin-toggle-tags]", (b) => !b.disabled));

console.log("- regression: existing real-plugin toggles still operable -");
// toggle testid uses row.id (daily-notes/unique-notes), not pluginId (daily-note/unique-note)
for (const id of ["random-note","daily-notes","unique-notes","word-count"]) {
  ok(`existing real plugin toggle operable: ${id}`, await page.$eval(`[data-testid=core-plugin-toggle-${id}]`, (b) => !b.disabled));
}
await closeSettings();

console.log(`\n${passed} passed, ${failed} failed`);
if (pageErrors.length) console.log("page errors:\n" + pageErrors.join("\n"));
await browser.close();
if (failed > 0) process.exit(1);
