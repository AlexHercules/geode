/**
 * R177 — G1: Settings three-section IA refactor — browser :1420.
 * Run: node .calibration/r177-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 177 additions" (G1).
 *
 * SettingsModal split from 5 flat sections into Obsidian's grouped IA:
 *  - 选项 (Options): about / editor / files-and-links / appearance / hotkeys / keychain / plugins
 *  - 核心插件 (Core plugins): command-palette / templates / daily-notes / unique-notes / page-preview
 *  - 第三方插件 (per-plugin tabs, R163, group preserved)
 * Controls mis-placed in Appearance are migrated to the correct page. Pure
 * frontend; every control keeps its store binding (data-safety: no lost value).
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
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.geode.app, null, { timeout: 15000 });
await page.evaluate(() => { window.__app = window.geode.app; });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const present = (sel) => page.$(sel).then((h) => !!h);
const tid = (id) => `[data-testid="${id}"]`;
const openSettings = async () => {
  await ev(() => window.__app.workspace.openModal("settings"));
  await page.waitForSelector(tid("settings-modal"), { timeout: 5000 });
  await wait(60);
};
const closeSettings = async () => {
  await page.click(tid("settings-close"));
  await wait(60);
};
const nav = async (id) => { await page.click(tid(`settings-nav-${id}`)); await wait(50); };

await openSettings();

console.log("— three nav groups with headers —");
ok("Options group header present", await present(tid("settings-navgroup-options")));
ok("Core plugins group header present", await present(tid("settings-navgroup-core-plugins")));
ok("Options header text = Options", (await page.textContent(tid("settings-navgroup-options")))?.trim() === "Options");
ok("Core plugins header text = Core plugins",
  (await page.textContent(tid("settings-navgroup-core-plugins")))?.trim() === "Core plugins");
ok("Options group renders before Core plugins group", await ev(() => {
  const o = document.querySelector('[data-testid="settings-navgroup-options"]');
  const c = document.querySelector('[data-testid="settings-navgroup-core-plugins"]');
  return !!o && !!c && (o.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}));

console.log("— Options group: existing + new nav entries —");
for (const id of ["about", "editor", "files-and-links", "appearance", "hotkeys", "keychain", "plugins"]) {
  ok(`nav entry present: ${id}`, await present(tid(`settings-nav-${id}`)));
}
console.log("— Core plugins group: nav entries —");
for (const id of ["command-palette", "templates", "daily-notes", "unique-notes", "page-preview"]) {
  ok(`nav entry present: ${id}`, await present(tid(`settings-nav-${id}`)));
}

console.log("— default section is still Appearance (r163 invariant) —");
ok("appearance nav active on open",
  await ev(() => document.querySelector('[data-testid="settings-nav-appearance"]')?.className.includes("is-active")));
ok("appearance keeps theme + accent + font controls",
  (await present(tid("settings-theme-select"))) &&
  (await present(tid("settings-accent-color"))) &&
  (await present(tid("settings-font-size"))) &&
  (await present(tid("settings-inline-title-toggle"))));
ok("appearance NO LONGER shows migrated editor/files controls",
  !(await present(tid("settings-line-numbers-toggle"))) &&
  !(await present(tid("settings-attachment-folder"))) &&
  !(await present(tid("settings-language"))));

console.log("— Editor page hosts migrated editor controls —");
await nav("editor");
ok("editor section container active", await present(tid("settings-section-editor")));
for (const id of ["settings-readable-toggle", "settings-spellcheck-toggle", "settings-strict-linebreaks-toggle",
  "settings-line-numbers-toggle", "settings-autopair-toggle", "settings-fold-heading-toggle",
  "settings-newtab-reading", "settings-tab-indent-size", "settings-properties-display"]) {
  ok(`editor has ${id}`, await present(tid(id)));
}
ok("editor does NOT show appearance theme control", !(await present(tid("settings-theme-select"))));

console.log("— Files & links page hosts migrated file/link controls —");
await nav("files-and-links");
for (const id of ["settings-detect-extensions-toggle", "settings-auto-update-links", "settings-link-use-markdown",
  "settings-link-path-format", "settings-newnote-location", "settings-attachment-folder", "settings-excluded-files"]) {
  ok(`files-and-links has ${id}`, await present(tid(id)));
}

console.log("— Core plugin pages host their controls —");
await nav("templates");
ok("templates has folder/date/time", (await present(tid("settings-template-folder"))) &&
  (await present(tid("settings-template-date-format"))) && (await present(tid("settings-template-time-format"))));
await nav("daily-notes");
ok("daily-notes has folder/format/template", (await present(tid("settings-daily-folder"))) &&
  (await present(tid("settings-daily-format"))) && (await present(tid("settings-daily-template"))));
await nav("unique-notes");
ok("unique-notes has folder/format/template", (await present(tid("settings-unique-folder"))) &&
  (await present(tid("settings-unique-format"))) && (await present(tid("settings-unique-template"))));
await nav("page-preview");
ok("page-preview has toggle + modifier", (await present(tid("settings-page-preview"))) &&
  (await present(tid("settings-page-preview-modifier"))));

console.log("— About page now hosts language; Keychain is an empty stub —");
await nav("about");
ok("about hosts migrated language control", await present(tid("settings-language")));
await nav("keychain");
ok("keychain empty-state present", await present(tid("settings-keychain-empty")));
ok("keychain empty text mentions keys",
  (await page.textContent(tid("settings-keychain-empty")))?.toLowerCase().includes("keys"));

console.log("— DATA-SAFETY: migrated control keeps live binding + persists across reopen —");
await nav("editor");
const TOGGLE = tid("settings-line-numbers-toggle");
const checkedNow = () => ev((s) => document.querySelector(s)?.getAttribute("aria-checked") === "true", TOGGLE);
const lsNow = () => ev(() => localStorage.getItem("geode.showLineNumbers"));
const before = await checkedNow();
await page.click(TOGGLE);
await wait(50);
const after = await checkedNow();
ok("toggling in its NEW (editor) home flips aria-checked", after === !before);
ok("setter wrote through to the appearance store (localStorage)", (await lsNow()) === String(after));
// reopen and confirm the read binding reflects the persisted value (not lost in the move)
await closeSettings();
await openSettings();
await nav("editor");
ok("reopened editor page reflects persisted value (read binding intact)", (await checkedNow()) === after);
// restore default so the run leaves no residue
if (after === true) { await page.click(TOGGLE); await wait(50); }
ok("restored line-numbers to default false", (await lsNow()) === "false");

console.log("— R163 per-plugin tab group still coexists with the new groups —");
await closeSettings();
await ev(async () => {
  const app = window.geode.app;
  await window.geode.registerPlugin({ id: "r177", name: "R177 Test Plugin", onload() {} });
  app.plugins.addSettingsSection({
    id: "r177:settings:0", pluginId: "r177", name: "R177 Test Plugin",
    mount(el) { el.innerHTML = '<div data-testid="r177-settings-content">hi</div>'; },
    unmount() {},
  });
});
await openSettings();
ok("per-plugin nav entry appears alongside the new groups",
  await present(tid("settings-nav-plugin-r177:settings:0")));
await page.click(tid("settings-nav-plugin-r177:settings:0"));
await wait(60);
ok("per-plugin tab still mounts its display()", await present(tid("r177-settings-content")));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR177: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
