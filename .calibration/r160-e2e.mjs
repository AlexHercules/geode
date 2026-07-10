/**
 * R160 — C5 visible sidebar collapse/expand toggles E2E — browser mode :1420.
 * Run: node .calibration/r160-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 160 additions" (Tier 7 C5).
 *
 * C5 state/methods/commands/persistence already existed (R2+); this round adds
 * Open sidebars use Obsidian-style buttons in their horizontal top bars. A compact
 * edge affordance appears only while a sidebar is closed, preserving discoverability
 * without leaving non-native pills over the editor canvas.
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
    localStorage.setItem("geode.locale", "en");
    localStorage.removeItem("geode.workspace.v1"); // reset to default: both sidebars open
  } catch {}
});
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
// capture the core app (commands.execute) the way R159 does
await page.evaluate(() => window.geode.registerPlugin({ id: "r160", name: "r160", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const present = (sel) => page.$(sel).then((h) => !!h);
const iconPaths = (testid) => page.$$eval(`[data-testid=${testid}] svg path`, (paths) => paths.map((path) => path.getAttribute("d")));
const centerX = (testid) => page.$eval(`[data-testid=${testid}]`, (el) => {
  const r = el.getBoundingClientRect();
  return r.left + r.width / 2;
});
const topY = (testid) => page.$eval(`[data-testid=${testid}]`, (el) => el.getBoundingClientRect().top);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PANEL_LEFT_RULE = "M9 3v18";
const PANEL_RIGHT_RULE = "M15 3v18";

console.log("— toggles exist + visible, default both sidebars open —");
ok("sidebar-toggle-left present", await present("[data-testid=sidebar-toggle-left]"));
ok("sidebar-toggle-right present", await present("[data-testid=sidebar-toggle-right]"));
ok("left toggle visible", await page.isVisible("[data-testid=sidebar-toggle-left]"));
ok("right toggle visible", await page.isVisible("[data-testid=sidebar-toggle-right]"));
ok("left sidebar shown by default", await present("[data-testid=left-sidebar]"));
ok("right sidebar shown by default", await present("[data-testid=right-sidebar]"));

console.log("— open-state controls live in the aligned sidebar top bars —");
ok("left toggle uses panel-left icon when open", (await iconPaths("sidebar-toggle-left")).includes(PANEL_LEFT_RULE));
ok("right toggle uses panel-right icon when open", (await iconPaths("sidebar-toggle-right")).includes(PANEL_RIGHT_RULE));

console.log("— open left toggle is inside the sidebar top bar —");
const leftXopen = await centerX("sidebar-toggle-left");
ok("left toggle center is inside the left sidebar", leftXopen > 44 && leftXopen < 320, `got ${Math.round(leftXopen)}`);

console.log("— left toggle collapses then expands the left sidebar —");
await page.click("[data-testid=sidebar-toggle-left]");
await wait(60);
ok("left sidebar removed after collapse", !(await present("[data-testid=left-sidebar]")));
ok("collapsed left toggle keeps the Obsidian panel-left icon", (await iconPaths("sidebar-toggle-left")).includes(PANEL_LEFT_RULE));
ok("collapsed left toggle stays in the top workspace row", (await topY("sidebar-toggle-left")) < 10);
const leftXclosed = await centerX("sidebar-toggle-left");
ok("left toggle moved toward ribbon when collapsed (<100px)", leftXclosed < 100, `got ${Math.round(leftXclosed)}`);
await page.click("[data-testid=sidebar-toggle-left]");
await wait(60);
ok("left sidebar restored after expand", await present("[data-testid=left-sidebar]"));
ok("left toggle returns to panel-left icon when re-opened", (await iconPaths("sidebar-toggle-left")).includes(PANEL_LEFT_RULE));

console.log("— right toggle collapses then expands the right sidebar —");
await page.click("[data-testid=sidebar-toggle-right]");
await wait(60);
ok("right sidebar removed after collapse", !(await present("[data-testid=right-sidebar]")));
ok("collapsed right toggle keeps the Obsidian panel-right icon", (await iconPaths("sidebar-toggle-right")).includes(PANEL_RIGHT_RULE));
ok("collapsed right toggle stays in the top workspace row", (await topY("sidebar-toggle-right")) < 10);
await page.click("[data-testid=sidebar-toggle-right]");
await wait(60);
ok("right sidebar restored after expand", await present("[data-testid=right-sidebar]"));

console.log("— collapsed state persists across reload (workspace state) —");
await page.click("[data-testid=sidebar-toggle-left]");
await wait(120); // let persist() write localStorage
ok("left sidebar collapsed pre-reload", !(await present("[data-testid=left-sidebar]")));
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
// reload wipes runtime plugin registrations → re-capture the core app
await page.evaluate(() => window.geode.registerPlugin({ id: "r160b", name: "r160b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
ok("left sidebar still collapsed after reload", !(await present("[data-testid=left-sidebar]")));
ok("left toggle still shows the panel-left icon after reload", (await iconPaths("sidebar-toggle-left")).includes(PANEL_LEFT_RULE));
// restore for cleanliness
await page.click("[data-testid=sidebar-toggle-left]");
await wait(60);
ok("left sidebar restored post-reload click", await present("[data-testid=left-sidebar]"));

console.log("— existing command path stays wired (unbound but executable) —");
await page.evaluate(() => window.__app.commands.execute("app:toggle-left-sidebar"));
await wait(60);
ok("command app:toggle-left-sidebar collapses sidebar", !(await present("[data-testid=left-sidebar]")));
await page.evaluate(() => window.__app.commands.execute("app:toggle-left-sidebar"));
await wait(60);
ok("command app:toggle-left-sidebar re-opens sidebar", await present("[data-testid=left-sidebar]"));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR160: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
