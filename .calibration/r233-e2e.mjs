/**
 * R233 editor "Always focus new tabs" toggle E2E — browser mode :1420.
 * Run: node .calibration/r233-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 233 additions".
 *
 * Obsidian's "Always focus new tabs" (始终聚焦新标签页, default ON): opening a file in a NEW tab
 * switches focus to it. OFF → the new tab opens in the background (focus stays on the current tab).
 * Geode gates workspace.openFile's new-tab branch on the `focusNewTab` Store; explicit working-tab
 * commands (Cmd+T new-tab, reopen-closed-tab) pass focus:true to bypass it (they must focus).
 * This suite asserts: default ON steals focus; OFF opens in background (tab exists, active unchanged);
 * Cmd+T + reopen still focus even when OFF; persistence + reload honored.
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
await page.evaluate(() => { try { localStorage.removeItem("geode.focusNewTab"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r233", name: "r233", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// create the fixture notes and open A as the active tab (replace-in-place — always focuses)
const seedFiles = async () => {
  await app(async () => {
    const W = window.__app;
    for (const n of ["A.md", "B.md", "C.md", "D.md"]) { try { await W.vault.create(n, n); } catch { /* exists */ } }
    W.workspace.openFile("A.md");
  });
};
await seedFiles();

const activeFile = () => app(() => window.__app.workspace.getActiveFile());
const allTabPaths = () => app(() => window.__app.workspace.getPanes().flatMap((p) => p.tabs.map((t) => t.filePath)));
const openNewTab = (path, focus) => app((a) => {
  window.__app.workspace.openFile(a.path, a.focus === undefined ? { newTab: true } : { newTab: true, focus: a.focus });
}, { path, focus });

const toggleFocusNewTab = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-editor"]');
  await wait(80);
  await page.waitForSelector("[data-testid=settings-focus-new-tab-toggle]", { timeout: 3000 });
  await page.click("[data-testid=settings-focus-new-tab-toggle]");
  await wait(60);
  await app(() => window.__app.workspace.closeModal());
  await wait(40);
};

console.log("— there is an 'Always focus new tabs' toggle in editor settings, default ON —");
await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-editor"]');
await page.waitForSelector("[data-testid=settings-focus-new-tab-toggle]", { timeout: 3000 });
ok("'Always focus new tabs' toggle defaults ON",
  (await app(() => document.querySelector('[data-testid="settings-focus-new-tab-toggle"]')?.getAttribute("aria-checked"))) === "true");
ok("toggle label is the native string",
  (await app(() => document.querySelector('[data-testid="settings-focus-new-tab-toggle"]')?.closest(".setting-item")?.querySelector(".setting-name")?.textContent)) === "Always focus new tabs");
await app(() => window.__app.workspace.closeModal());
await wait(40);

console.log("— default ON: opening a file in a new tab steals focus —");
ok("active starts on A.md", (await activeFile()) === "A.md");
await openNewTab("B.md");
await wait(40);
ok("ON: openFile('B.md', {newTab}) → active is now B.md (focused)", (await activeFile()) === "B.md");

console.log("— toggle OFF: a new tab opens in the BACKGROUND (active unchanged, tab still created) —");
await toggleFocusNewTab();
ok("the pref persisted to localStorage as 'false'", (await app(() => localStorage.getItem("geode.focusNewTab"))) === "false");
const beforeBg = await activeFile();
await openNewTab("C.md");
await wait(40);
ok("OFF: openFile('C.md', {newTab}) → active is UNCHANGED (still " + beforeBg + ")", (await activeFile()) === beforeBg);
ok("OFF: the background tab for C.md was still created", (await allTabPaths()).includes("C.md"));

console.log("— OFF but focus:true (the Cmd+T / reopen mechanism) → forces focus —");
await openNewTab("D.md", true);
await wait(40);
ok("OFF + focus:true: openFile('D.md', {newTab, focus:true}) → active is D.md", (await activeFile()) === "D.md");

console.log("— the Cmd+T 'new tab' command always focuses, even with the setting OFF —");
const tabsBeforeNewTab = (await allTabPaths()).length;
await app(() => window.geode.app.commands.execute("app:new-tab"));
await wait(80);
const afterNewTab = await app(() => ({ active: window.__app.workspace.getActiveFile(), count: window.__app.workspace.getPanes().flatMap((p) => p.tabs).length }));
ok("Cmd+T created a new tab", afterNewTab.count === tabsBeforeNewTab + 1);
ok("Cmd+T focused the new (Untitled) tab despite setting OFF", afterNewTab.active !== "D.md" && afterNewTab.active !== null);

console.log("— reopen-closed-tab always focuses + restores, even with the setting OFF —");
await app(() => window.__app.workspace.openFile("A.md")); // active back to A (replace-in-place)
await wait(40);
await app(() => {
  const W = window.__app;
  const bTab = W.workspace.getPanes().flatMap((p) => p.tabs).find((t) => t.filePath === "B.md");
  if (bTab) W.workspace.closeTab(bTab.id);
});
await wait(40);
ok("after closing B.md its tab is gone", !(await allTabPaths()).includes("B.md"));
await app(() => window.__app.workspace.reopenClosedTab());
await wait(60);
ok("reopen-closed-tab focused the reopened B.md (despite OFF)", (await activeFile()) === "B.md");

console.log("— toggle back ON: new-tab focus restored —");
await toggleFocusNewTab();
ok("pref persisted back to 'true'", (await app(() => localStorage.getItem("geode.focusNewTab"))) === "true");
await app(() => window.__app.workspace.openFile("A.md"));
await wait(40);
await openNewTab("C.md"); // C already has a (background) tab, but newTab:true forces a fresh focused one
await wait(40);
ok("ON again: opening in a new tab steals focus (active is C.md)", (await activeFile()) === "C.md");

console.log("— the OFF pref survives a reload —");
await toggleFocusNewTab(); // OFF again
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r233b", name: "r233b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await seedFiles();
const reloadActive = await activeFile();
await openNewTab("B.md");
await wait(40);
ok("after reload the OFF pref is honored (new tab does NOT steal focus)", (await activeFile()) === reloadActive);
ok("after reload the background tab was still created", (await allTabPaths()).includes("B.md"));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR233 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
