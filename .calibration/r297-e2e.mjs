/**
 * R297 core-plugin wave-3 (content services) + settings-Tab gate E2E - browser :1420.
 * Run: node .calibration/r297-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 297 additions".
 *
 * Final wave: Templates / File recovery / Note composer / Page preview / Bookmarks /
 * Properties view / Footnotes view become real builtin plugins. Each toggle genuinely
 * controls its feature (panel tab + render / modal command disposal / action-command
 * availability / hover suppression). NEW: disabling a core plugin also hides its native
 * settings section (the R294-deferred settings-Tab gate).
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
    for (const id of ["templates", "file-recovery", "note-composer", "page-preview", "bookmarks", "properties-view", "footnotes-view", "tags", "outline", "outgoing-links", "backlinks", "graph", "file-explorer", "search", "quick-switcher", "command-palette", "workspaces"]) delete map[id];
    localStorage.setItem("geode.plugins.enabled.v1", JSON.stringify(map));
    localStorage.setItem("geode.locale", "en");
  } catch {}
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r297", name: "r297", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cmdInPalette = (id) => app((cid) => window.__app.commands.list().some((c) => c.id === cid), id);
// list() is unfiltered; check a command's available() directly (for action commands gated via available)
const cmdAvailable = (id) => app((cid) => {
  const cmd = window.__app.commands.list().find((c) => c.id === cid);
  return cmd && cmd.available ? cmd.available() : true;
}, id);
const closeSettings = async () => { await app(() => window.__app.workspace.closeModal()); await wait(50); };
const openCorePlugins = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.waitForSelector("[data-testid=settings-modal]", { timeout: 3000 });
  await page.click("[data-testid=settings-nav-core-plugins]");
  await page.waitForSelector("[data-testid=core-plugin-toggle-templates]", { timeout: 3000 });
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

console.log("- default ON -");
ok("templates enabled", await app(() => window.geode.app.plugins.isEnabled("templates")));
ok("templates: editor:insert-template in palette", await cmdInPalette("editor:insert-template"));
ok("file-recovery enabled", await app(() => window.geode.app.plugins.isEnabled("file-recovery")));
ok("file-recovery: editor:file-recovery in palette", await cmdInPalette("editor:file-recovery"));
ok("note-composer enabled", await app(() => window.geode.app.plugins.isEnabled("note-composer")));
ok("page-preview enabled", await app(() => window.geode.app.plugins.isEnabled("page-preview")));
ok("bookmarks enabled", await app(() => window.geode.app.plugins.isEnabled("bookmarks")));
ok("bookmarks: left-tab-bookmarks visible", await page.$("[data-testid=left-tab-bookmarks]") !== null);
ok("bookmarks: bookmarks:show in palette", await cmdInPalette("bookmarks:show"));
ok("properties-view enabled", await app(() => window.geode.app.plugins.isEnabled("properties-view")));
ok("properties-view: right-tab-allproperties visible", await page.$("[data-testid=right-tab-allproperties]") !== null);
ok("properties-view: app:show-all-properties in palette", await cmdInPalette("app:show-all-properties"));
ok("footnotes-view enabled", await app(() => window.geode.app.plugins.isEnabled("footnotes-view")));
ok("footnotes-view: right-tab-footnotes visible", await page.$("[data-testid=right-tab-footnotes]") !== null);
ok("footnotes-view: app:show-footnotes in palette", await cmdInPalette("app:show-footnotes"));

console.log("- note-composer action commands need an active file -");
await app(async () => {
  try { await window.__app.vault.create("r297.md", "# x\n"); } catch {}
  window.__app.workspace.openFile("r297.md");
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
// select a range so extract-selection is available
await app(() => {
  const v = window.__app.documents.getActiveView().view;
  v.dispatch({ selection: { anchor: 0, head: 3 } });
});
await wait(50);
ok("extract-selection available (note-composer on, selection)", await cmdAvailable("editor:extract-selection"));
ok("move-heading available (note-composer on)", await cmdAvailable("editor:move-heading"));
ok("merge-file available (note-composer on)", await cmdAvailable("editor:merge-file"));

console.log("- disable each wave-3 feature -");
// panel features: tab hidden + show-command disposed
await toggle("bookmarks", false);
ok("bookmarks: disabled", await app(() => !window.geode.app.plugins.isEnabled("bookmarks")));
ok("bookmarks: left-tab-bookmarks hidden", await page.$("[data-testid=left-tab-bookmarks]") === null);
ok("bookmarks: bookmarks:show gone", !(await cmdInPalette("bookmarks:show")));
await app(() => window.__app.workspace.setLeftPanel("bookmarks"));
await wait(50);
ok("bookmarks: disabled panel body does not render", await page.$("[data-testid=bookmarks-panel]") === null);
await toggle("properties-view", false);
ok("properties-view: right-tab-allproperties hidden", await page.$("[data-testid=right-tab-allproperties]") === null);
ok("properties-view: app:show-all-properties gone", !(await cmdInPalette("app:show-all-properties")));
await app(() => window.__app.workspace.setRightPanel("allproperties"));
await wait(50);
ok("properties-view: disabled panel body does not render", await page.$("[data-testid=allproperties-panel]") === null);
await toggle("footnotes-view", false);
ok("footnotes-view: right-tab-footnotes hidden", await page.$("[data-testid=right-tab-footnotes]") === null);
ok("footnotes-view: app:show-footnotes gone", !(await cmdInPalette("app:show-footnotes")));
await app(() => window.__app.workspace.setRightPanel("footnotes"));
await wait(50);
ok("footnotes-view: disabled panel body does not render", await page.$("[data-testid=footnotes-panel]") === null);
// modal features: command disposed
await toggle("templates", false);
ok("templates: editor:insert-template gone", !(await cmdInPalette("editor:insert-template")));
ok("templates: app:new-note-from-template gone", !(await cmdInPalette("app:new-note-from-template")));
await app(() => window.__app.commands.execute("editor:insert-template"));
await wait(50);
ok("templates: disposed command cannot open selector", await page.$("[data-testid=template-selector]") === null);
await toggle("file-recovery", false);
ok("file-recovery: editor:file-recovery gone", !(await cmdInPalette("editor:file-recovery")));
await app(() => window.__app.commands.execute("editor:file-recovery"));
await wait(50);
ok("file-recovery: disposed command cannot open recovery modal", await page.$("[data-testid=recovery-modal]") === null);
// note-composer: action commands available()==false (gated, not disposed)
await toggle("note-composer", false);
ok("extract-selection NOT available (note-composer off)", !(await cmdAvailable("editor:extract-selection")));
ok("move-heading NOT available (note-composer off)", !(await cmdAvailable("editor:move-heading")));
ok("merge-file NOT available (note-composer off)", !(await cmdAvailable("editor:merge-file")));
const composerBefore = await app(async () => ({
  files: window.__app.vault.getFiles().length,
  text: await window.__app.vault.read("r297.md"),
}));
await app(() => {
  window.__app.commands.execute("editor:extract-selection");
  window.__app.commands.execute("editor:move-heading");
  window.__app.commands.execute("editor:merge-file");
});
await wait(200);
const composerAfter = await app(async () => ({
  files: window.__app.vault.getFiles().length,
  text: await window.__app.vault.read("r297.md"),
  modal: window.__app.workspace.state.get().modal,
}));
ok("note-composer: direct execute creates no note while disabled", composerAfter.files === composerBefore.files);
ok("note-composer: direct execute leaves source bytes unchanged", composerAfter.text === composerBefore.text);
ok("note-composer: direct merge execute does not open switcher", composerAfter.modal !== "switcher");
// page-preview: real hover + disable races (not just the enabled flag)
await page.hover('[data-hover-path="Getting Started.md"]');
await page.waitForSelector('[data-testid="hover-preview"]', { timeout: 2000 });
ok("page-preview: enabled hover renders a card", await page.$('[data-testid="hover-preview"]') !== null);
await app(() => window.geode.app.plugins.disable("page-preview"));
await page.waitForFunction(() => !document.querySelector('[data-testid="hover-preview"]'));
ok("page-preview: disabling clears an already-visible card", await page.$('[data-testid="hover-preview"]') === null);
await app(() => window.geode.app.plugins.enable("page-preview", { userAction: true }));
await page.dispatchEvent('[data-hover-path="Getting Started.md"]', "mouseover");
await wait(50);
await app(() => window.geode.app.plugins.disable("page-preview"));
await wait(400);
ok("page-preview: disabling cancels a pending show timer", await page.$('[data-testid="hover-preview"]') === null);
ok("page-preview disabled", await app(() => !window.geode.app.plugins.isEnabled("page-preview")));

console.log("- settings-Tab gate: disabling a plugin hides its settings section -");
await openCorePlugins();
// templates is disabled above -> its settings nav item hidden + gear disabled
ok("templates settings nav hidden when disabled", await page.$("[data-testid=settings-nav-templates]") === null);
ok("templates gear disabled when disabled", await page.$eval("[data-testid=core-plugin-settings-templates]", (b) => b.disabled));
// re-enable templates -> nav item back + gear enabled
await page.click("[data-testid=core-plugin-toggle-templates]");
await wait(80);
ok("templates settings nav visible when re-enabled", await page.$("[data-testid=settings-nav-templates]") !== null);
ok("templates gear enabled when re-enabled", await page.$eval("[data-testid=core-plugin-settings-templates]", (b) => !b.disabled));
// note-composer still disabled -> its settings nav hidden
ok("note-composer settings nav hidden when disabled", await page.$("[data-testid=settings-nav-note-composer]") === null);
// active-section fallback: disable the section currently being viewed -> Core plugins
await app(() => window.geode.app.plugins.enable("page-preview", { userAction: true }));
await wait(60);
await page.click("[data-testid=settings-nav-page-preview]");
await app(() => window.geode.app.plugins.disable("page-preview"));
await page.waitForSelector("[data-testid=settings-core-plugin-list]", { timeout: 2000 });
ok("active disabled settings section falls back to Core plugins", await page.$("[data-testid=settings-core-plugin-list]") !== null);
await closeSettings();

console.log("- re-enable all -");
for (const id of ["bookmarks", "properties-view", "footnotes-view", "file-recovery", "note-composer", "page-preview"]) {
  await toggle(id, true);
  ok(`${id} re-enabled`, await app((pid) => window.geode.app.plugins.isEnabled(pid), id));
}
ok("note-composer re-enabled: extract-selection available again", await cmdAvailable("editor:extract-selection"));
ok("note-composer re-enabled: merge-file available again", await cmdAvailable("editor:merge-file"));

console.log("- every native plugin settings section follows its plugin state -");
for (const [pluginId, section, rowId] of [
  ["templates", "templates", "templates"],
  ["note-composer", "note-composer", "note-composer"],
  ["page-preview", "page-preview", "page-preview"],
  ["quick-switcher", "quick-switcher", "quick-switcher"],
  ["command-palette", "command-palette", "command-palette"],
  ["daily-note", "daily-notes", "daily-notes"],
  ["unique-note", "unique-notes", "unique-notes"],
]) {
  await app((pid) => window.geode.app.plugins.disable(pid), pluginId);
  await openCorePlugins();
  ok(`${pluginId}: settings nav hidden when disabled`, await page.$(`[data-testid=settings-nav-${section}]`) === null);
  ok(`${pluginId}: settings gear disabled when disabled`, await page.$eval(`[data-testid=core-plugin-settings-${rowId}]`, (b) => b.disabled));
  await closeSettings();
  await app((pid) => window.geode.app.plugins.enable(pid, { userAction: true }), pluginId);
}

console.log("- restart persistence (all seven wave-3 plugins) -");
const wave3 = ["templates", "file-recovery", "note-composer", "page-preview", "bookmarks", "properties-view", "footnotes-view"];
for (const id of wave3) await app((pid) => window.geode.app.plugins.disable(pid), id);
await wait(60);
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r297", name: "r297", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
for (const id of wave3) {
  ok(`${id} stays disabled after reload`, await app((pid) => !window.geode.app.plugins.isEnabled(pid), id));
}
await openCorePlugins();
ok("templates nav hidden after reload", await page.$("[data-testid=settings-nav-templates]") === null);
await closeSettings();
ok("bookmarks tab hidden after reload", await page.$("[data-testid=left-tab-bookmarks]") === null);
// restore defaults
for (const id of wave3) await app((pid) => window.geode.app.plugins.enable(pid, { userAction: true }), id);
await wait(50);

console.log("- catalog: 7 wave-3 rows now have operable toggles -");
await openCorePlugins();
for (const id of ["templates", "file-recovery", "note-composer", "page-preview", "bookmarks", "properties-view", "footnotes-view"]) {
  ok(`toggle operable: ${id}`, await page.$eval(`[data-testid=core-plugin-toggle-${id}]`, (b) => !b.disabled));
}
await closeSettings();
ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join("\n"));

console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
if (failed > 0) process.exit(1);
