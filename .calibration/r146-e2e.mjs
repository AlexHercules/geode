/**
 * R146 compat WorkspaceLeaf.setPinned / togglePinned E2E — browser mode :1420.
 * Run: node .calibration/r146-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 146 additions".
 *
 * Adds the two confirmed-missing @public WorkspaceLeaf methods (obsidian.d.ts): setPinned(pinned)
 * + togglePinned(). They map the active tab onto Geode's R39 tab-pin (toggleTabPin). Verified via
 * the compat App on window.app.workspace.activeLeaf (what a real plugin reaches), observing the
 * active tab's .is-pinned class.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r146", name: "r146", onload(app) { window.__app = app; } }));
// window.app is the compat App (set by the obsidian loader at bootstrap) — what plugins read
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// open a markdown file → an active tab/leaf exists
await app(async () => {
  try { await window.__app.vault.create("r146.md", "# r146 pin probe\n"); } catch { /* exists */ }
  await window.__app.workspace.openFile("r146.md");
});
await page.waitForSelector('.tab.is-active', { timeout: 4000 });
const activePinned = () => app(() => document.querySelector('.tab.is-active')?.classList.contains("is-pinned") ?? null);
const leaf = (method, arg) => app(([m, a]) => { window.app.workspace.activeLeaf[m](a); }, [method, arg]);

console.log("— setPinned(true) pins the active tab; setPinned(false) unpins it —");
ok("the active tab starts unpinned", (await activePinned()) === false);
await leaf("setPinned", true);
await wait(80);
ok("after setPinned(true) the active tab is pinned (.is-pinned)", (await activePinned()) === true);
await leaf("setPinned", false);
await wait(80);
ok("after setPinned(false) the active tab is unpinned", (await activePinned()) === false);

console.log("— setPinned is idempotent (setting the same value twice doesn't toggle back) —");
await leaf("setPinned", true);
await wait(60);
await leaf("setPinned", true); // second identical set must be a no-op, not a toggle-off
await wait(60);
ok("setPinned(true) twice → still pinned (idempotent, no spurious toggle)", (await activePinned()) === true);

console.log("— togglePinned() flips the pin state —");
await leaf("togglePinned"); // currently pinned → unpin
await wait(80);
ok("togglePinned() from pinned → unpinned", (await activePinned()) === false);
await leaf("togglePinned"); // → pin again
await wait(80);
ok("togglePinned() from unpinned → pinned", (await activePinned()) === true);

console.log("— the methods exist as functions on the compat leaf (real plugin path) —");
const shapes = await app(() => {
  const l = window.app.workspace.activeLeaf;
  return { setPinned: typeof l.setPinned, togglePinned: typeof l.togglePinned };
});
ok("activeLeaf.setPinned is a function", shapes.setPinned === "function", JSON.stringify(shapes));
ok("activeLeaf.togglePinned is a function", shapes.togglePinned === "function", JSON.stringify(shapes));

console.log("— a SIDEBAR-view leaf's pin methods are a no-op (must NOT pin a main-area tab) —");
// review F1: SidebarViewLeaf inherits the base facade; without an override, setPinned would
// findActiveTab in the MAIN area and pin an unrelated tab. Ensure the main tab is untouched.
await leaf("setPinned", false); // ensure main tab unpinned baseline
await wait(60);
ok("baseline: main active tab unpinned", (await activePinned()) === false);
await app(() => { window.app.workspace.getRightLeaf(false).setPinned(true); });
await wait(80);
ok("sidebar leaf setPinned(true) does NOT pin the main-area tab", (await activePinned()) === false);
await app(() => { window.app.workspace.getRightLeaf(false).togglePinned(); });
await wait(80);
ok("sidebar leaf togglePinned() does NOT pin the main-area tab", (await activePinned()) === false);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR146 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
