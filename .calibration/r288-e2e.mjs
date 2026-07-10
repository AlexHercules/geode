/**
 * R288 — full-workspace Obsidian chrome calibration.
 * Run: node .calibration/r288-e2e.mjs (dev server :1420 must be running).
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const failures = [];
function ok(name, condition, extra = "") {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.geode?.app, null, { timeout: 15000 });
await page.evaluate(async () => {
  const app = window.geode.app;
  app.workspace.setTheme("light");
  try { await app.vault.create("r288/nested/chrome.md", "# Chrome"); } catch {}
  app.workspace.openFile("r288/nested/chrome.md");
});
await page.waitForSelector(".editor-header", { timeout: 5000 });

const metrics = await page.evaluate(() => {
  const read = (selector, pseudo) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const css = getComputedStyle(element, pseudo);
    return {
      height: Math.round(rect.height),
      background: css.backgroundColor,
      color: css.color,
      borderBottomWidth: css.borderBottomWidth,
      borderBottomColor: css.borderBottomColor,
      filter: css.filter,
      width: Math.round(rect.width),
    };
  };
  return {
    ribbon: read(".ribbon"),
    ribbonDivider: (() => {
      const ribbon = document.querySelector(".ribbon");
      if (!ribbon) return null;
      const css = getComputedStyle(ribbon, "::after");
      return { top: css.top, bottom: css.bottom, width: css.width };
    })(),
    ribbonSpacer: read(".ribbon-top-spacer"),
    leftTop: read(".sidebar-primary-tabs"),
    leftActive: read(".sidebar-primary-tab.is-active"),
    leftHeader: read(".sidebar-left .panel-header"),
    tabBar: read(".tab-bar"),
    activeTab: read(".tab.is-active"),
    editorPane: read(".editor-pane"),
    viewHeader: read(".editor-header"),
    rightTop: read(".right-tabs"),
    rightActive: read(".right-tab.is-active"),
    leftTabCount: document.querySelectorAll(".sidebar-primary-tabs button").length,
    openPills: document.querySelectorAll(".sidebar-toggle").length,
    chromeIcons: Array.from(document.querySelectorAll(
      ".ribbon-btn svg, .sidebar-primary-tab svg, .right-tab svg, .panel-header .panel-actions svg",
    )).map((icon) => {
      const rect = icon.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        filter: getComputedStyle(icon).filter,
        strokeWidth: icon.getAttribute("stroke-width"),
      };
    }),
  };
});

console.log("— aligned workspace chrome —");
const topRows = [metrics.ribbonSpacer, metrics.leftTop, metrics.tabBar, metrics.rightTop];
const secondaryRows = [metrics.leftHeader, metrics.viewHeader];
ok("the single top workspace row is exactly 42px", topRows.every((row) => row?.height === 42), JSON.stringify(topRows));
ok("only the top workspace row keeps the continuous 1px divider", topRows.every((row) => row?.borderBottomWidth === "1px" && row.borderBottomColor === topRows[0]?.borderBottomColor), JSON.stringify(topRows));
ok("the ribbon divider starts below the unified top row", metrics.ribbonDivider?.top === "42px" && metrics.ribbonDivider?.bottom === "0px" && metrics.ribbonDivider?.width === "1px", JSON.stringify(metrics));
ok("editor path and sidebar action rows have no lower divider", secondaryRows.every((row) => row?.borderBottomWidth === "0px"), JSON.stringify(secondaryRows));
ok("the active tab opens into the editor canvas", metrics.activeTab?.background === metrics.editorPane?.background && metrics.activeTab?.borderBottomColor === metrics.activeTab?.background, JSON.stringify(metrics));
ok("left horizontal toolbar exposes explorer/search/bookmarks/collapse", metrics.leftTabCount === 4, JSON.stringify(metrics));
ok("open sidebars no longer show floating middle-edge pills", metrics.openPills === 0, JSON.stringify(metrics));

console.log("— neutral, colorless functional bars —");
ok("ribbon and sidebars share the neutral panel background", metrics.ribbon?.background === "rgb(245, 245, 245)", JSON.stringify(metrics.ribbon));
ok("editor view header stays white like the canvas", metrics.viewHeader?.background === "rgb(255, 255, 255)", JSON.stringify(metrics.viewHeader));
ok("left active tool is neutral rather than accent-colored", metrics.leftActive?.background === "rgba(0, 0, 0, 0.09)" && metrics.leftActive?.color === "rgb(34, 34, 34)", JSON.stringify(metrics.leftActive));
ok("right active tool is neutral rather than accent-colored", metrics.rightActive?.background === "rgba(0, 0, 0, 0.09)" && metrics.rightActive?.color === "rgb(34, 34, 34)", JSON.stringify(metrics.rightActive));
ok("functional-bar icons are monochrome", metrics.chromeIcons.length > 0 && metrics.chromeIcons.every((icon) => icon.filter === "grayscale(1)"), JSON.stringify(metrics.chromeIcons));
ok("functional-bar icons keep the 15–18px Obsidian scale", metrics.chromeIcons.every((icon) => icon.width >= 15 && icon.width <= 18 && icon.height >= 15 && icon.height <= 18), JSON.stringify(metrics.chromeIcons));

console.log("— explorer selection and nesting lines —");
const folder = page.locator('[data-path="r288"]');
ok("test folder exists", await folder.count() === 1);
await folder.click();
await page.waitForSelector('[data-path="r288/nested"]');
const nestedGuide = await page.locator('[data-path="r288/nested"]').evaluate((element) => ({
  width: getComputedStyle(element, "::before").width,
  background: getComputedStyle(element, "::before").backgroundImage,
}));
ok("nested rows render Obsidian-style 1px guide lines", nestedGuide.width === "14px" && nestedGuide.background.includes("linear-gradient"), JSON.stringify(nestedGuide));
await page.locator('[data-path="r288/nested"]').click();
await page.waitForSelector('[data-path="r288/nested/chrome.md"]');
const activeFile = await page.locator('[data-path="r288/nested/chrome.md"]').evaluate((element) => {
  const css = getComputedStyle(element);
  return { background: css.backgroundColor, color: css.color, boxShadow: css.boxShadow };
});
ok("active file uses a neutral gray row without accent edge", activeFile.background === "rgba(0, 0, 0, 0.09)" && activeFile.color === "rgb(34, 34, 34)" && activeFile.boxShadow === "none", JSON.stringify(activeFile));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
await browser.close();
console.log(`\nR288 e2e: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", failures.join(", "));
process.exit(failed ? 1 : 0);
