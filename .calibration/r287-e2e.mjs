/**
 * R287 — Obsidian-style Markdown view header + developer action registry.
 * Run: node .calibration/r287-e2e.mjs (dev server :1420 must be running)
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0;
let failed = 0;
const failures = [];
function ok(name, condition, extra = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name} ${extra}`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1436, height: 700 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.geode?.app, null, { timeout: 15000 });
await page.evaluate(async () => {
  const app = window.geode.app;
  app.workspace.setTheme("light");
  try { await app.vault.create("r287/editor-header.md", "# Editor header\n\nPixel calibration"); } catch {}
  app.workspace.openFile("r287/editor-header.md");
});
await page.waitForSelector('[data-testid="editor-more-options"]', { timeout: 5000 });

console.log("— two-level editor chrome —");
const chrome = await page.evaluate(() => {
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      background: css.backgroundColor,
      radius: css.borderRadius,
      outline: css.outlineStyle,
    };
  };
  return {
    tabBar: box(".tab-bar"),
    activeTab: box(".tab.is-active"),
    header: box(".editor-header"),
    breadcrumbs: document.querySelector(".editor-breadcrumbs")?.textContent?.trim() ?? "",
    navInHeader: document.querySelectorAll(".editor-header .editor-nav-actions button").length,
    navInTabs: document.querySelectorAll(".tab-bar .tab-nav").length,
    duplicateTitle: document.querySelectorAll(".editor-header .editor-title").length,
    oldModeGroup: document.querySelectorAll(".editor-mode-group").length,
    readingToggle: document.querySelectorAll('[data-testid="mode-reading-toggle"]').length,
    more: document.querySelectorAll('[data-testid="editor-more-options"]').length,
    tabListToggle: document.querySelectorAll('[data-testid^="tab-list-toggle-"]').length,
  };
});
ok("tab bar matches the 42px sidebar top bar", chrome.tabBar?.height === 42, JSON.stringify(chrome.tabBar));
ok("editor view header matches the 42px sidebar top bar", chrome.header?.height === 42, JSON.stringify(chrome.header));
ok("active tab uses raised 12px top corners", chrome.activeTab?.radius === "12px 12px 0px 0px", JSON.stringify(chrome.activeTab));
ok("history navigation moved from tabs into the view header", chrome.navInTabs === 0 && chrome.navInHeader === 2, JSON.stringify(chrome));
ok("header has one breadcrumb trail and no duplicate file title", chrome.breadcrumbs.length > 0 && chrome.duplicateTitle === 0, JSON.stringify(chrome));
ok("old three-button mode group is replaced by one reading toggle", chrome.oldModeGroup === 0 && chrome.readingToggle === 1, JSON.stringify(chrome));
ok("top row owns a real open-tabs dropdown", chrome.tabListToggle === 1, JSON.stringify(chrome));
ok("view row owns the more-actions button", chrome.more === 1, JSON.stringify(chrome));

console.log("— top open-tabs dropdown —");
await page.click('[data-testid^="tab-list-toggle-"]');
await page.waitForSelector('[data-testid="tab-list-menu"]');
const tabMenu = await page.evaluate(() => ({
  items: document.querySelectorAll('[data-testid^="tab-list-item-"]').length,
  selected: document.querySelectorAll(".tab-list-menu .is-selected").length,
}));
ok("open-tabs dropdown lists every open tab", tabMenu.items >= 1, JSON.stringify(tabMenu));
ok("open-tabs dropdown marks exactly one active tab", tabMenu.selected === 1, JSON.stringify(tabMenu));
await page.click('[data-testid^="tab-list-toggle-"]');
ok("open-tabs button toggles its dropdown closed", await page.locator('[data-testid="tab-list-menu"]').count() === 0);

console.log("— Markdown view more menu —");
await page.click('[data-testid="editor-more-options"]');
await page.waitForSelector('[data-testid="editor-view-options-menu"]');
const menu = await page.evaluate(() => {
  const element = document.querySelector('[data-testid="editor-view-options-menu"]');
  const rect = element.getBoundingClientRect();
  const css = getComputedStyle(element);
  return {
    width: Math.round(rect.width),
    background: css.backgroundColor,
    backdrop: css.backdropFilter,
    reading: !!element.querySelector('[data-testid="editor-menu-reading"]'),
    source: !!element.querySelector('[data-testid="editor-menu-source"]'),
    bookmark: !!element.querySelector('[data-testid="editor-menu-bookmark"]'),
    rename: !!element.querySelector('[data-testid="editor-menu-rename"]'),
    deleteFile: !!element.querySelector('[data-testid="editor-menu-delete"]'),
  };
});
ok("more menu is the 250px Obsidian-style surface", menu.width === 250 && menu.background !== "rgb(255, 255, 255)" && menu.backdrop.includes("blur(18px)"), JSON.stringify(menu));
ok("more menu exposes real view modes", menu.reading && menu.source, JSON.stringify(menu));
ok("more menu keeps bookmark/rename/delete first-class actions", menu.bookmark && menu.rename && menu.deleteFile, JSON.stringify(menu));
await page.click('[data-testid="editor-more-options"]');
ok("more button toggles its menu closed", await page.locator('[data-testid="editor-view-options-menu"]').count() === 0);

console.log("— developer-registered custom SVG action —");
await page.evaluate(async () => {
  window.__r287Clicks = 0;
  await window.geode.registerPlugin({
    id: "r287-view-action",
    name: "R287 View Action",
    onload(app) {
      window.__r287App = app;
      app.ui.addViewHeaderAction("spark", {
        title: "R287 spark",
        iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/></svg>',
        onClick() { window.__r287Clicks += 1; },
      });
    },
  });
});
const ACTION = '[data-testid="view-header-action-r287-view-action:spark"]';
await page.waitForSelector(ACTION);
ok("custom SVG action renders in the active Markdown header", await page.locator(ACTION).count() === 1);
ok("custom contribution renders its registered SVG", await page.locator(`${ACTION} svg`).count() === 1);
await page.click(ACTION);
ok("registered action callback runs", await page.evaluate(() => window.__r287Clicks) === 1);

await page.evaluate(() => window.__r287App.workspace.splitActivePane("row"));
await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 2, ACTION);
ok("split panes render independent copies of one contribution", await page.locator(ACTION).count() === 2);

await page.evaluate(() => window.geode.app.plugins.disable("r287-view-action"));
await page.waitForFunction((selector) => document.querySelectorAll(selector).length === 0, ACTION);
ok("disabling the plugin removes every view-header action", await page.locator(ACTION).count() === 0);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
console.log(`\nR287 e2e: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", failures.join(", "));
process.exit(failed === 0 ? 0 : 1);
