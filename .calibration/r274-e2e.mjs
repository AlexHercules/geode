/**
 * R274 — editor right-click file-actions: Open in new tab / Open to the right.
 * Run: node .calibration/r274-e2e.mjs   (dev server :1420 up)
 * Contract: docs/ARCHITECTURE.md "Round 274 additions".
 *
 * Obsidian reference/08 shows these two items in the editor context menu. Explorer
 * already had the vetted handlers; R274 promotes them to command-registry entries
 * and includes them in compat/obsidian/editorMenu.ts, with real icons.
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

await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r274", name: "r274", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__app.workspace, null, { timeout: 8000 });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const app = (fn, arg) => page.evaluate(fn, arg);
const cmdName = (id) => app((i) => {
  const c = window.__app.commands.list().find((x) => x.id === i);
  return c ? (typeof c.name === "function" ? c.name() : c.name) : null;
}, id);
const openLive = async (path) => {
  await app(async (p) => {
    try { await window.__app.vault.create(p, "# R274\n\nbody\n"); } catch {}
    window.__app.workspace.openFile(p);
    await new Promise((r) => setTimeout(r, 120));
    const tab = window.__app.workspace.getActiveTab();
    if (tab) window.__app.workspace.setTabMode(tab.id, "live");
  }, path);
  await page.waitForSelector(".cm-content", { timeout: 8000 });
  await wait(180);
};
const openMenu = async () => {
  await app(() => {
    const v = window.__app.documents.getActiveView().view;
    const r = v.contentDOM.getBoundingClientRect();
    v.contentDOM.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(r.left + 32),
      clientY: Math.round(r.top + 10),
    }));
  });
  await page.waitForSelector('[data-testid="compat-menu"]', { timeout: 3000 });
};
const menuItems = () => page.$$eval('[data-testid="compat-menu-item"]', (els) => els.map((el) => ({
  text: el.textContent.trim(),
  hasSvg: !!el.querySelector(".menu-item-icon svg"),
  missing: !!el.querySelector(".geode-icon-missing"),
  warning: el.classList.contains("is-warning"),
})));
const clickItem = (label) => page.$$eval('[data-testid="compat-menu-item"]', (els, l) => {
  const item = els.find((el) => el.textContent.trim() === l);
  if (item instanceof HTMLElement) item.click();
}, label);
const layout = () => app(() => ({
  panes: window.__app.workspace.getPanes().map((p) => ({ id: p.id, tabs: p.tabs.map((t) => t.filePath), activeTabId: p.activeTabId })),
  active: window.__app.workspace.getActiveFile(),
}));

const openNewTab = await cmdName("file-explorer:open-in-new-tab");
const openRight = await cmdName("file-explorer:open-to-right");
ok("command registered: open in new tab", openNewTab === "Open in new tab", String(openNewTab));
ok("command registered: open to the right", openRight === "Open to the right", String(openRight));

console.log("A. editor menu contains both missing Obsidian file-actions, with real icons —");
await openLive("r274.md");
await openMenu();
const beforeItems = await menuItems();
const labels = beforeItems.map((i) => i.text);
ok("Open in new tab appears in editor menu", labels.includes(openNewTab), JSON.stringify(labels));
ok("Open to the right appears in editor menu", labels.includes(openRight), JSON.stringify(labels));
for (const label of [openNewTab, openRight]) {
  const item = beforeItems.find((i) => i.text === label);
  ok(`${label} has an SVG icon`, item?.hasSvg === true);
  ok(`${label} icon is not the missing placeholder`, item?.missing === false);
}
ok("browser still hides desktop-only reveal/open-default items", !labels.includes(await cmdName("file-explorer:reveal-in-system")) && !labels.includes(await cmdName("file-explorer:open-in-default-app")));
ok("delete remains the warning item at the end", beforeItems.at(-1)?.warning === true);

console.log("B. clicking Open in new tab duplicates the active file as another tab —");
const tabsBefore = (await layout()).panes.reduce((n, p) => n + p.tabs.length, 0);
await clickItem(openNewTab);
await wait(250);
const afterNewTab = await layout();
const tabsAfter = afterNewTab.panes.reduce((n, p) => n + p.tabs.length, 0);
ok("Open in new tab adds exactly one tab", tabsAfter === tabsBefore + 1, `${tabsBefore} → ${tabsAfter}`);
ok("active file remains r274.md after new-tab open", afterNewTab.active === "r274.md", JSON.stringify(afterNewTab));

console.log("C. clicking Open to the right creates/focuses a right pane for the active file —");
await openMenu();
const panesBefore = (await layout()).panes.length;
await clickItem(openRight);
await wait(300);
const afterRight = await layout();
ok("Open to the right adds exactly one pane", afterRight.panes.length === panesBefore + 1, `${panesBefore} → ${afterRight.panes.length}`);
ok("the new layout still has r274.md active", afterRight.active === "r274.md", JSON.stringify(afterRight));
ok("some pane contains r274.md after right-open", afterRight.panes.some((p) => p.tabs.includes("r274.md")), JSON.stringify(afterRight));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
console.log(`\nR274 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); process.exit(1); }
