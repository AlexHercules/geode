/**
 * R237 status-bar vault name → vault switcher entry E2E — browser mode :1420.
 * Run: node .calibration/r237-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 237 additions".
 *
 * Obsidian's vault name is a persistent click target in the left dock footer. It opens a
 * compact current/recent-vault menu; the full R203 manager remains the final menu entry.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r237", name: "r237", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const modal = () => app(() => window.__app.workspace.state.get().modal);

console.log("— the left-sidebar vault name is a clickable button —");
await page.waitForSelector('[data-testid="status-vault"]', { timeout: 4000 });
ok("status-vault is a <button>", (await app(() => document.querySelector('[data-testid="status-vault"]')?.tagName)) === "BUTTON");
ok("status-vault shows the vault name", (await app(() => document.querySelector('[data-testid="status-vault"]')?.textContent?.trim()))?.length > 0);
ok("status-vault has a switch-vault tooltip", (await app(() => document.querySelector('[data-testid="status-vault"]')?.getAttribute("title")))?.toLowerCase().includes("vault"));
ok("vault switcher is inside the left sidebar footer", await app(() => !!document.querySelector('.sidebar-left [data-testid="sidebar-vault-footer"] [data-testid="status-vault"]')));
ok("theme toggle is removed from the vertical ribbon", await app(() => !document.querySelector('.ribbon [title*="theme" i]')));
ok("settings is beside the vault switcher", await app(() => !!document.querySelector('[data-testid="sidebar-vault-footer"] [data-testid="sidebar-footer-settings"]')));
ok("statistics are a standalone floating badge", await app(() => {
  const bar = document.querySelector('[data-testid="status-bar"]');
  if (!bar) return false;
  const css = getComputedStyle(bar);
  return css.position === "absolute" && bar.getBoundingClientRect().width < window.innerWidth / 2;
}));

console.log("— the relocated settings button remains functional —");
await page.click('[data-testid="sidebar-footer-settings"]');
await wait(120);
ok("footer settings opens the settings modal", (await modal()) === "settings");
await app(() => window.__app.workspace.closeModal());
await wait(80);

console.log("— clicking it opens the Obsidian-style compact menu —");
ok("no modal open initially", (await modal()) === null);
await page.click('[data-testid="status-vault"]');
await wait(120);
ok("clicking the vault name does not jump straight to a modal", (await modal()) === null);
ok("the compact vault menu is in the DOM", await app(() => !!document.querySelector('[data-testid="vault-switcher-menu"]')));
ok("the current vault is checked", await app(() => document.querySelector('[data-testid="vault-switcher-menu"] [role="menuitemradio"]')?.getAttribute("aria-checked") === "true"));
ok("the full manager remains available", await app(() => !!document.querySelector('[data-testid="vault-switcher-manage"]')));

console.log("— Manage vaults… opens the existing full manager —");
await page.click('[data-testid="vault-switcher-manage"]');
await wait(120);
ok("the manage entry opens the vault manager", (await modal()) === "vaultmanager");
ok("the vault manager modal is in the DOM", await app(() => !!document.querySelector('[data-testid="vaultmanager-modal"]')));
await app(() => window.__app.workspace.closeModal());

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR237 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
