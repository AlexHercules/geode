/**
 * R145 hotkeys "show assigned only" filter toggle E2E — browser mode :1420.
 * Run: node .calibration/r145-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 145 additions".
 *
 * Obsidian (verified): "To show only commands that have assigned hotkeys, select the filter icon in
 * Settings → Hotkeys." R145 adds that funnel toggle to HotkeysSection: ON → only commands whose
 * effective hotkey is non-null; composes (AND) with the existing text filter; per-mount session state.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r145", name: "r145", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

// register one command WITH a hotkey and one WITHOUT
await page.evaluate(() => {
  window.__app.commands.register({ id: "r145:bound", name: "ZZF Bound Command", callback: () => {} });
  window.__app.commands.register({ id: "r145:unbound", name: "ZZF Unbound Command", callback: () => {} });
  // a command with a DEFAULT hotkey, then explicitly unbound (override=null) — the faithfulness-
  // critical branch: getEffectiveHotkey returns null, so it must be filtered OUT under assigned-only.
  window.__app.commands.register({ id: "r145:defaultbound", name: "ZZF Defaultbound Command", callback: () => {}, hotkey: "Ctrl+Shift+8" });
  window.__app.commands.setHotkeyOverride("r145:bound", "Ctrl+Shift+9");
});

const app = (fn) => page.evaluate(fn);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (sel) => page.isVisible(sel);

const openHotkeys = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.waitForSelector('[data-testid="settings-modal"]', { timeout: 3000 });
  await page.click('[data-testid="settings-nav-hotkeys"]');
  await page.waitForSelector('[data-testid="settings-hotkeys-assigned-toggle"]', { timeout: 3000 });
  // narrow to just our two test commands via the text filter
  await page.fill('[data-testid="settings-hotkeys-filter"]', "ZZF");
  await wait(60);
};

console.log("— the funnel toggle exists and is OFF by default —");
await openHotkeys();
ok("the assigned-only funnel toggle is present", await visible('[data-testid="settings-hotkeys-assigned-toggle"]'));
ok("it starts inactive (default OFF)", await app(() => !document.querySelector('[data-testid="settings-hotkeys-assigned-toggle"]').classList.contains("is-active")));
ok("both bound + unbound commands are shown by default", (await visible('[data-testid="hotkey-row-r145:bound"]')) && (await visible('[data-testid="hotkey-row-r145:unbound"]')));

console.log("— toggling the funnel ON shows only commands with an assigned hotkey —");
await page.click('[data-testid="settings-hotkeys-assigned-toggle"]');
await wait(60);
ok("the toggle is now active", await app(() => document.querySelector('[data-testid="settings-hotkeys-assigned-toggle"]').classList.contains("is-active")));
ok("the toggle is aria-pressed when active", await app(() => document.querySelector('[data-testid="settings-hotkeys-assigned-toggle"]').getAttribute("aria-pressed") === "true"));
ok("the BOUND command (has hotkey) is still shown", await visible('[data-testid="hotkey-row-r145:bound"]'));
ok("the UNBOUND command (no hotkey) is filtered out", !(await visible('[data-testid="hotkey-row-r145:unbound"]')));

console.log("— toggling the funnel OFF restores all commands —");
await page.click('[data-testid="settings-hotkeys-assigned-toggle"]');
await wait(60);
ok("the toggle is inactive again", await app(() => !document.querySelector('[data-testid="settings-hotkeys-assigned-toggle"]').classList.contains("is-active")));
ok("the unbound command is shown again", await visible('[data-testid="hotkey-row-r145:unbound"]'));

console.log("— the funnel composes (AND) with the text filter —");
await page.click('[data-testid="settings-hotkeys-assigned-toggle"]'); // ON
await wait(40);
await page.fill('[data-testid="settings-hotkeys-filter"]', "ZZF Unbound"); // matches only the unbound one by text
await wait(60);
ok("text='ZZF Unbound' + assigned-only → empty (text matches unbound, but it has no hotkey)", await visible('[data-testid="settings-hotkeys-empty"]'));
await page.fill('[data-testid="settings-hotkeys-filter"]', "ZZF Bound");
await wait(60);
ok("text='ZZF Bound' + assigned-only → the bound command shows", await visible('[data-testid="hotkey-row-r145:bound"]'));

console.log("— a DEFAULT hotkey shows under assigned-only; an explicit unbind hides it —");
await page.fill('[data-testid="settings-hotkeys-filter"]', "ZZF Defaultbound");
await wait(60);
// funnel is still ON from the previous section
ok("a command with a DEFAULT hotkey shows under assigned-only", await visible('[data-testid="hotkey-row-r145:defaultbound"]'));
await app(() => window.__app.commands.setHotkeyOverride("r145:defaultbound", null)); // explicit unbind
await wait(80);
ok("after explicit unbind (override=null) it is filtered OUT under assigned-only", !(await visible('[data-testid="hotkey-row-r145:defaultbound"]')));
ok("…and the empty state shows (no other assigned command matches the text)", await visible('[data-testid="settings-hotkeys-empty"]'));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR145 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
