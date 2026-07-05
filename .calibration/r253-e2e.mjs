/**
 * R253 Vim mode E2E — browser mode :1420. Contract: docs/ARCHITECTURE.md "Round 253 additions".
 * Run: node .calibration/r253-e2e.mjs   (dev server must be up)
 *
 * Obsidian's Editor "Vim key bindings" (@replit/codemirror-vim). Geode gates it on a vimMode Store
 * (default OFF) via a CM Compartment reconfigured in EditorPane (mirrors R232 smart lists). KEY
 * data-safety assertion (底线①): vim edits go through the standard CM dispatch, so docChanged fires
 * and the file is autosaved — a vim edit must NOT be lost. Tests: toggle default OFF + persists,
 * enabling makes the editor enter normal mode (a letter is a command, not inserted), an `i`-insert
 * edit + Esc autosaves to disk, live↔source keeps vim active, and OFF restores normal typing.
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
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); localStorage.removeItem("geode.vimMode"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r253", name: "r253", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const docStr = () => app(() => window.__app.documents.getActiveView()?.view.state.doc.toString() ?? null);
const read = (p) => app((x) => window.__app.vault.read(x), p);
const setCursor = (n) => app((i) => { const v = window.__app.documents.getActiveView().view; v.focus(); v.dispatch({ selection: { anchor: i } }); }, n);
const openVim = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-editor"]');
  await page.waitForSelector('[data-testid="settings-vim-mode-toggle"]', { timeout: 3000 });
};

await app(async () => {
  await window.__app.vault.create("vim.md", "hello world\nsecond line\n").catch(() => {});
  window.__app.workspace.openFile("vim.md");
  const t = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(t.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(200);

console.log("— the Vim key bindings toggle is present in Editor settings, default OFF —");
await openVim();
ok("vim toggle present", await app(() => !!document.querySelector('[data-testid="settings-vim-mode-toggle"]')));
ok("defaults OFF (Obsidian default)", (await app(() => document.querySelector('[data-testid="settings-vim-mode-toggle"]')?.getAttribute("aria-checked"))) === "false");

console.log("— toggling ON persists + the editor reconfigures live (no rebuild) —");
await page.click('[data-testid="settings-vim-mode-toggle"]');
await wait(80);
ok("toggle persisted ON to localStorage", (await app(() => localStorage.getItem("geode.vimMode"))) === "true");
await app(() => window.__app.workspace.closeModal());
await wait(120);

console.log("— with Vim ON the editor is in NORMAL mode: a letter is a command, not inserted —");
await setCursor(0); // start of "hello world"
await page.keyboard.press("x"); // normal-mode: delete char under cursor (NOT insert 'x')
await wait(120);
ok("'x' in normal mode deleted 'h' → 'ello world…' (vim active, not inserting)", (await docStr())?.startsWith("ello world"), await docStr());

console.log("— `i` enters insert mode, edit + Esc, and the vim edit is AUTOSAVED (底线①) —");
await page.keyboard.press("i"); // insert mode
await wait(60);
await page.keyboard.type("Z");
await page.keyboard.press("Escape"); // back to normal
await wait(120);
ok("insert 'Z' at cursor → 'Zello world…'", (await docStr())?.startsWith("Zello world"), await docStr());
await wait(700); // let autosave debounce flush
ok("the vim edit was AUTOSAVED to disk (no data loss)", (await read("vim.md"))?.startsWith("Zello world"), await read("vim.md"));

console.log("— Vim survives a live↔source mode switch (vimCompartment is in the base list) —");
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "source"); });
await wait(400); // let the modeCompartment reconfigure + re-render settle before driving vim keys
await setCursor(0);
await wait(80);
await page.keyboard.press("x"); // still normal-mode after the mode switch
await wait(120);
ok("after live→source switch, 'x' still acts as a vim command (vim not destroyed)", (await docStr())?.startsWith("ello world"), await docStr());

console.log("— toggling Vim OFF restores plain typing —");
await openVim();
await page.click('[data-testid="settings-vim-mode-toggle"]');
await wait(80);
ok("toggle persisted OFF", (await app(() => localStorage.getItem("geode.vimMode"))) === "false");
await app(() => window.__app.workspace.closeModal());
await wait(120);
const before = await docStr();
await setCursor(0);
await page.keyboard.type("Q"); // plain insert now (vim off)
await wait(120);
ok("with Vim OFF, typing 'Q' inserts it (normal editing restored)", (await docStr()) === "Q" + before, await docStr());

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR253 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
