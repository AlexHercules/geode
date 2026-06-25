/**
 * R237 status-bar vault name → vault switcher entry E2E — browser mode :1420.
 * Run: node .calibration/r237-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 237 additions".
 *
 * Obsidian's vault name is a persistent click target that opens the vault switcher. Geode's
 * status-bar vault name was a static <span>; R237 makes it a <button> that executes the
 * (R203) app:switch-vault command → opens the vault switcher modal.
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

console.log("— the status-bar vault name is a clickable button —");
await page.waitForSelector('[data-testid="status-vault"]', { timeout: 4000 });
ok("status-vault is a <button>", (await app(() => document.querySelector('[data-testid="status-vault"]')?.tagName)) === "BUTTON");
ok("status-vault shows the vault name", (await app(() => document.querySelector('[data-testid="status-vault"]')?.textContent?.trim()))?.length > 0);
ok("status-vault has a switch-vault tooltip", (await app(() => document.querySelector('[data-testid="status-vault"]')?.getAttribute("title")))?.toLowerCase().includes("vault"));

console.log("— clicking it opens the vault switcher modal —");
ok("no modal open initially", (await modal()) === null);
await page.click('[data-testid="status-vault"]');
await wait(120);
ok("clicking the vault name opens the vault switcher", (await modal()) === "vaultswitcher");
ok("the vault switcher modal is in the DOM", await app(() => !!document.querySelector('[data-testid="vaultswitcher-modal"]')));

console.log("— the modal closes (and the entry still works a second time) —");
await app(() => window.__app.workspace.closeModal());
await wait(80);
ok("modal closed", (await modal()) === null);
await page.click('[data-testid="status-vault"]');
await wait(120);
ok("the vault name re-opens the switcher (idempotent entry)", (await modal()) === "vaultswitcher");
await app(() => window.__app.workspace.closeModal());

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR237 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
