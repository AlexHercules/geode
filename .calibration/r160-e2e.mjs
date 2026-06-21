/**
 * R160 — C5 visible sidebar collapse/expand toggles E2E — browser mode :1420.
 * Run: node .calibration/r160-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 160 additions" (Tier 7 C5).
 *
 * C5 state/methods/commands/persistence already existed (R2+); this round adds
 * the only missing piece — a dedicated, always-visible collapse/expand affordance
 * ([data-testid=sidebar-toggle-left|right]) straddling each sidebar↔main border.
 * Commands stay UNBOUND (Obsidian's real default); the toggle is the visible path.
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
const chevronD = (testid) => page.getAttribute(`[data-testid=${testid}] svg path`, "d");
const centerX = (testid) => page.$eval(`[data-testid=${testid}]`, (el) => {
  const r = el.getBoundingClientRect();
  return r.left + r.width / 2;
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CHEVRON_LEFT = "M15 18l-6-6 6-6";
const CHEVRON_RIGHT = "M9 18l6-6-6-6";

console.log("— toggles exist + visible, default both sidebars open —");
ok("sidebar-toggle-left present", await present("[data-testid=sidebar-toggle-left]"));
ok("sidebar-toggle-right present", await present("[data-testid=sidebar-toggle-right]"));
ok("left toggle visible", await page.isVisible("[data-testid=sidebar-toggle-left]"));
ok("right toggle visible", await page.isVisible("[data-testid=sidebar-toggle-right]"));
ok("left sidebar shown by default", await present("[data-testid=left-sidebar]"));
ok("right sidebar shown by default", await present("[data-testid=right-sidebar]"));

console.log("— icon points inward (collapse) when open —");
ok("left toggle = chevron-left (inward) when open", (await chevronD("sidebar-toggle-left")) === CHEVRON_LEFT);
ok("right toggle = chevron-right (inward) when open", (await chevronD("sidebar-toggle-right")) === CHEVRON_RIGHT);

console.log("— toggle repositions with sidebar width (left toggle near border when open) —");
const leftXopen = await centerX("sidebar-toggle-left");
ok("left toggle center near sidebar/main border when open (>300px)", leftXopen > 300, `got ${Math.round(leftXopen)}`);

console.log("— left toggle collapses then expands the left sidebar —");
await page.click("[data-testid=sidebar-toggle-left]");
await wait(60);
ok("left sidebar removed after collapse", !(await present("[data-testid=left-sidebar]")));
ok("left toggle = chevron-right (outward) when collapsed", (await chevronD("sidebar-toggle-left")) === CHEVRON_RIGHT);
const leftXclosed = await centerX("sidebar-toggle-left");
ok("left toggle moved toward ribbon when collapsed (<100px)", leftXclosed < 100, `got ${Math.round(leftXclosed)}`);
await page.click("[data-testid=sidebar-toggle-left]");
await wait(60);
ok("left sidebar restored after expand", await present("[data-testid=left-sidebar]"));
ok("left toggle back to chevron-left when re-opened", (await chevronD("sidebar-toggle-left")) === CHEVRON_LEFT);

console.log("— right toggle collapses then expands the right sidebar —");
await page.click("[data-testid=sidebar-toggle-right]");
await wait(60);
ok("right sidebar removed after collapse", !(await present("[data-testid=right-sidebar]")));
ok("right toggle = chevron-left (outward) when collapsed", (await chevronD("sidebar-toggle-right")) === CHEVRON_LEFT);
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
ok("left toggle still shows expand icon after reload", (await chevronD("sidebar-toggle-left")) === CHEVRON_RIGHT);
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
