/**
 * R278 hotkeys page Obsidian-style chip + plus/delete controls E2E — browser mode :1420.
 * Run: node .calibration/r278-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 278 additions".
 *
 * Obsidian's hotkeys page shows a rounded key chip with an inline × for bound commands,
 * a circular + button to capture/rebind, and an "未设置"/"Not set" label when unbound.
 * Geode keeps single-override semantics: + opens capture, chip × explicitly unbinds.
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
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r278", name: "r278", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (sel) => page.isVisible(sel);

const openHotkeys = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.waitForSelector('[data-testid="settings-modal"]', { timeout: 3000 });
  await page.click('[data-testid="settings-nav-hotkeys"]');
  await page.waitForSelector('[data-testid="settings-hotkeys-filter"]', { timeout: 3000 });
};

await app(() => {
  window.__app.commands.register({ id: "r278:unbound", name: "ZZZ R278 Unbound", callback: () => {} });
  window.__app.commands.register({ id: "r278:default", name: "ZZZ R278 Default", callback: () => {}, hotkey: "Ctrl+Shift+9" });
});

await openHotkeys();
await page.fill('[data-testid="settings-hotkeys-filter"]', "ZZZ R278");
await wait(80);

const chipFor = (id) => `[data-testid="hotkey-row-${id}"] .hotkey-chip`;
const unsetFor = (id) => `[data-testid="hotkey-row-${id}"] .hotkey-unset`;
const addFor = (id) => `[data-testid="hotkey-add-${id}"]`;
const deleteFor = (id) => `[data-testid="hotkey-delete-${id}"]`;

console.log("— unbound command shows 'Not set' and a circular plus —");
ok("unbound: unset label visible", await visible(unsetFor("r278:unbound")));
ok("unbound: plus button visible", await visible(addFor("r278:unbound")));
ok("unbound: no key chip", !(await visible(chipFor("r278:unbound"))));

console.log("— clicking + on an unbound command captures a hotkey —");
await page.click(addFor("r278:unbound"));
await wait(40);
await page.keyboard.press("Shift+F7");
await wait(80);
ok("after capture: key chip visible", await visible(chipFor("r278:unbound")));
ok("after capture: chip delete visible", await visible(deleteFor("r278:unbound")));
ok("after capture: plus still visible", await visible(addFor("r278:unbound")));
const chip1 = await app((id) => document.querySelector(`[data-testid="hotkey-row-${id}"] .hotkey-chip`)?.textContent ?? "", "r278:unbound");
ok("chip shows the captured key (F7)", /F7/i.test(chip1), chip1);

console.log("— clicking the chip × removes the binding —");
await page.click(deleteFor("r278:unbound"));
await wait(80);
ok("after delete: unset label visible", await visible(unsetFor("r278:unbound")));
ok("after delete: key chip gone", !(await visible(chipFor("r278:unbound"))));

console.log("— default hotkey renders as a chip and can be unbound —");
ok("default: key chip visible", await visible(chipFor("r278:default")));
const chipDefault = await app((id) => document.querySelector(`[data-testid="hotkey-row-${id}"] .hotkey-chip`)?.textContent ?? "", "r278:default");
ok("default chip shows the default key (9)", /9/.test(chipDefault), chipDefault);
await page.click(deleteFor("r278:default"));
await wait(80);
ok("default after delete: unset label visible", await visible(unsetFor("r278:default")));

console.log("— + on a bound command rebinds to a new hotkey —");
// restore a binding first
await page.click(addFor("r278:unbound"));
await wait(40);
await page.keyboard.press("Shift+F7");
await wait(80);
await page.click(addFor("r278:unbound"));
await wait(40);
await page.keyboard.press("Shift+F8");
await wait(80);
const chip2 = await app((id) => document.querySelector(`[data-testid="hotkey-row-${id}"] .hotkey-chip`)?.textContent ?? "", "r278:unbound");
ok("rebound chip shows the new key (F8)", /F8/i.test(chip2) && !/F7/i.test(chip2), chip2);

console.log("— Escape cancels capture and keeps the current binding —");
await page.click(addFor("r278:unbound"));
await wait(40);
await page.keyboard.press("Escape");
await wait(80);
const chipAfterEscape = await app((id) => document.querySelector(`[data-testid="hotkey-row-${id}"] .hotkey-chip`)?.textContent ?? "", "r278:unbound");
ok("Escape leaves the existing binding intact", /F8/i.test(chipAfterEscape), chipAfterEscape);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR278 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
