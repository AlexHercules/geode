/**
 * R286 — Obsidian screenshot-calibrated settings chrome and menu surfaces.
 * Run: node .calibration/r286-e2e.mjs (dev server :1420 must be running)
 *
 * Reference viewport: 2940×1912 Retina capture => 1470×956 CSS pixels.
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
const page = await browser.newPage({ viewport: { width: 1470, height: 956 }, deviceScaleFactor: 2 });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.geode?.app, null, { timeout: 15000 });
await page.evaluate(() => {
  localStorage.setItem("geode.locale", "zh-CN");
  window.geode.app.workspace.setTheme("light");
  window.geode.app.workspace.openModal("settings");
});
await page.waitForSelector('[data-testid="settings-modal"]');
await page.click('[data-testid="settings-nav-editor"]');

const geometry = await page.evaluate(() => {
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      background: css.backgroundColor,
      radius: css.borderRadius,
      padding: css.padding,
    };
  };
  return {
    panel: box(".settings-panel"),
    nav: box(".settings-nav"),
    card: box(".settings-card"),
    cards: document.querySelectorAll(".settings-card").length,
    overlay: getComputedStyle(document.querySelector(".modal-overlay")).backgroundColor,
    activeOutline: getComputedStyle(document.querySelector(".settings-nav-item.is-active")).outlineStyle,
  };
});

console.log("— settings geometry from the 2940×1912 reference captures —");
ok("settings panel is 1004×720", geometry.panel?.width === 1004 && geometry.panel?.height === 720, JSON.stringify(geometry.panel));
ok("settings panel is screenshot-positioned near 229×103", Math.abs(geometry.panel?.x - 229) <= 1 && Math.abs(geometry.panel?.y - 103) <= 1, JSON.stringify(geometry.panel));
ok("left navigation is 228px", geometry.nav?.width === 228, JSON.stringify(geometry.nav));
ok("editor page has four grouped cards", geometry.cards === 4, `got ${geometry.cards}`);
ok("first grouped card is 686×268 near 502×132", geometry.card?.width === 686 && geometry.card?.height === 268 && Math.abs(geometry.card?.x - 502) <= 1 && Math.abs(geometry.card?.y - 132) <= 1, JSON.stringify(geometry.card));
ok("grouped card uses the #fafafa light surface", geometry.card?.background === "rgb(250, 250, 250)", geometry.card?.background);
ok("grouped card has 12px corners and 20px horizontal inset", geometry.card?.radius === "12px" && geometry.card?.padding === "0px 20px", JSON.stringify(geometry.card));
ok("settings overlay keeps workspace legible", geometry.overlay === "rgba(0, 0, 0, 0.07)", geometry.overlay);
ok("active settings nav never paints a browser focus ring", geometry.activeOutline === "none", geometry.activeOutline);

console.log("— hotkeys form one continuous rounded card —");
await page.click('[data-testid="settings-nav-hotkeys"]');
const hotkeys = await page.evaluate(() => {
  const search = document.querySelector(".hotkeys-search-card");
  const list = document.querySelector(".hotkey-list");
  const row = document.querySelector(".hotkey-row");
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    return { x: Math.round(rect.x), width: Math.round(rect.width), height: Math.round(rect.height), background: css.backgroundColor, radius: css.borderRadius };
  };
  return { search: box(search), list: box(list), row: box(row) };
});
ok("hotkeys header and list share the same 686px card edge", hotkeys.search.width === 686 && hotkeys.list.width === 686 && hotkeys.search.x === hotkeys.list.x, JSON.stringify(hotkeys));
ok("hotkeys header/list share the same card surface", hotkeys.search.background === "rgb(250, 250, 250)" && hotkeys.list.background === hotkeys.search.background, JSON.stringify(hotkeys));
ok("hotkeys card joins top and bottom corner radii", hotkeys.search.radius === "12px 12px 0px 0px" && hotkeys.list.radius === "0px 0px 12px 12px", JSON.stringify(hotkeys));
ok("hotkey rows match the 54px screenshot density", hotkeys.row.height === 54, JSON.stringify(hotkeys.row));

console.log("— core plugin search is inside the shared list card —");
await page.click('[data-testid="settings-nav-core-plugins"]');
const core = await page.evaluate(() => {
  const card = document.querySelector(".core-plugin-list");
  const search = document.querySelector(".core-plugins-search");
  return {
    contains: card?.contains(search) ?? false,
    cardBg: card ? getComputedStyle(card).backgroundColor : "",
    searchWidth: search ? Math.round(search.getBoundingClientRect().width) : 0,
  };
});
ok("core plugin search belongs to the rounded plugin card", core.contains, JSON.stringify(core));
ok("core plugin card uses the grouped surface", core.cardBg === "rgb(250, 250, 250)", core.cardBg);
ok("core plugin search respects the 20px card inset", core.searchWidth === 646, `got ${core.searchWidth}`);

console.log("— file context menu uses the native-looking translucent surface —");
await page.click('[data-testid="settings-close"]');
await page.click('[data-testid="explorer-item"][data-path="Welcome.md"]', { button: "right" });
const menu = await page.evaluate(() => {
  const element = document.querySelector(".explorer-menu");
  const rect = element.getBoundingClientRect();
  const css = getComputedStyle(element);
  return { width: Math.round(rect.width), radius: css.borderRadius, backdrop: css.backdropFilter, shadow: css.boxShadow, background: css.backgroundColor };
});
ok("file menu stays at the 164px reference width", menu.width >= 164 && menu.width <= 166, JSON.stringify(menu));
ok("file menu uses 8px corners and backdrop blur", menu.radius === "8px" && menu.backdrop.includes("blur(18px)"), JSON.stringify(menu));
ok("file menu surface is distinct from a white modal", menu.background !== "rgb(255, 255, 255)", menu.background);
ok("file menu uses a compact native shadow", menu.shadow.includes("8px 24px"), menu.shadow);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
console.log(`\nR286 e2e: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", failures.join(", "));
process.exit(failed === 0 ? 0 : 1);
