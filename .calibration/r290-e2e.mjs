/**
 * R290 — Explorer context menus stay inside the viewport at the bottom edge.
 * Run: node .calibration/r290-e2e.mjs (dev server :1420 must be running).
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
const page = await browser.newPage({ viewport: { width: 860, height: 520 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.geode?.app && !!window.app?.workspace, null, { timeout: 15000 });
await page.evaluate(async () => {
  localStorage.setItem("geode.locale", "en");
  window.app.workspace.on("file-menu", (menu) => {
    for (let index = 1; index <= 18; index++) {
      menu.addItem((item) => item.setTitle(`Plugin action ${index}`));
    }
  });
  try { await window.geode.app.vault.create("r290-bottom-menu.md", "# bottom menu\n"); } catch {}
});

const rowSelector = '[data-testid="explorer-item"][data-path="r290-bottom-menu.md"]';
await page.waitForSelector(rowSelector, { timeout: 5000 });
await page.evaluate((selector) => {
  const row = document.querySelector(selector);
  row?.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    clientX: window.innerWidth - 2,
    clientY: window.innerHeight - 2,
  }));
}, rowSelector);
await page.waitForSelector('[data-testid="explorer-menu"]', { timeout: 3000 });

const metrics = await page.$eval('[data-testid="explorer-menu"]', (element) => {
  const rect = element.getBoundingClientRect();
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    visibility: getComputedStyle(element).visibility,
  };
});

console.log("— measured two-axis viewport placement —");
ok("bottom-right invocation is visible", metrics.visibility === "visible", JSON.stringify(metrics));
ok("menu stays inside the horizontal 8px gutter", metrics.left >= 8 && metrics.right <= metrics.viewportWidth - 8, JSON.stringify(metrics));
ok("menu flips above the bottom edge using its rendered height", metrics.top >= 8 && metrics.bottom <= metrics.viewportHeight - 8, JSON.stringify(metrics));
ok("an exceptionally tall plugin menu scrolls internally", metrics.scrollHeight > metrics.clientHeight, JSON.stringify(metrics));
ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();
console.log(`\nR290 e2e: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", failures.join(", "));
process.exit(failed ? 1 : 0);
