/**
 * R142 command palette "pinned commands" E2E — browser mode :1420.
 * Run: node .calibration/r142-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 142 additions".
 *
 * Obsidian "Settings → Command palette": pin commands via a "Select a command" picker; pinned
 * commands appear at the TOP of the palette on an empty query, ABOVE recents. Typing falls back to
 * fuzzy (pinned/recents give way to search). Per-vault localStorage `geode.cmdPinned:<vaultName>`.
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

const registerCommands = () =>
  page.evaluate(() => {
    window.geode.registerPlugin({ id: "r142", name: "r142", onload(app) { window.__app = app; } });
  });
await registerCommands();
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const addTestCommands = () =>
  page.evaluate(() => {
    window.__app.commands.register({ id: "r142:pin", name: "ZZP Pinme Command", callback: () => { window.__ran = "pin"; } });
    window.__app.commands.register({ id: "r142:other", name: "ZZP Other Command", callback: () => { window.__ran = "other"; } });
    window.__app.commands.register({ id: "r142:recent", name: "ZZP Recent Command", callback: () => { window.__ran = "recent"; } });
  });

// clear any prior recents/pins (determinism) + register benign test commands
await page.evaluate(() => {
  Object.keys(localStorage)
    .filter((k) => k.startsWith("geode.cmdRecent:") || k.startsWith("geode.cmdPinned:"))
    .forEach((k) => localStorage.removeItem(k));
});
await addTestCommands();

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const openPalette = async () => { await app(() => window.__app.workspace.openModal("palette")); await page.waitForSelector('[data-testid="palette-input"]', { timeout: 3000 }); };
const closeModal = () => app(() => window.__app.workspace.closeModal());
const firstItems = (n) => app(([k]) => [...document.querySelectorAll('[data-testid="palette-item"] .palette-item-name')].slice(0, k).map((e) => e.textContent), [n]);
const runViaPalette = async (typed) => {
  await openPalette();
  await page.fill('[data-testid="palette-input"]', typed);
  await wait(80);
  await page.locator('[data-testid="palette-input"]').press("Enter");
  await wait(80);
};
// open Settings → Command palette section
const openCmdPaletteSettings = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.waitForSelector('[data-testid="settings-modal"]', { timeout: 3000 });
  await page.click('[data-testid="settings-nav-command-palette"]');
  await page.waitForSelector('[data-testid="cmdpalette-add-input"]', { timeout: 3000 });
};

console.log("— pinning a command via Settings → Command palette adds it to the pinned list —");
await openCmdPaletteSettings();
await page.fill('[data-testid="cmdpalette-add-input"]', "Pinme");
await wait(80);
await page.click('[data-testid="cmdpalette-add-item"][data-id="r142:pin"]');
await wait(60);
ok("the pinned command shows up in the Pinned commands list", await page.isVisible('[data-testid="cmdpalette-pinned-row-r142:pin"]'));
ok("the add-input was cleared after pinning (dropdown closes)", (await app(() => document.querySelector('[data-testid="cmdpalette-add-input"]').value)) === "");
ok("localStorage now holds the pinned id", await app(() => Object.keys(localStorage).some((k) => k.startsWith("geode.cmdPinned:") && JSON.parse(localStorage.getItem(k)).includes("r142:pin"))));
await closeModal();

console.log("— a pinned command is FIRST in the palette on an empty query —");
await openPalette();
let top = await firstItems(1);
ok("the pinned command is at the top (empty query)", top[0] === "ZZP Pinme Command", JSON.stringify(top));
await closeModal();

console.log("— pinned commands rank ABOVE recently-used ones —");
await runViaPalette("ZZP Recent"); // record r142:recent as a recent
ok("the Recent command executed", (await app(() => window.__ran)) === "recent");
await openPalette();
const top2 = await firstItems(2);
ok("pinned (Pinme) is first, above the recent", top2[0] === "ZZP Pinme Command", JSON.stringify(top2));
ok("recent (Recent) is second, below the pin", top2[1] === "ZZP Recent Command", JSON.stringify(top2));
await closeModal();

console.log("— typing a query falls back to FUZZY (pinned doesn't override search) —");
await openPalette();
await page.fill('[data-testid="palette-input"]', "Other");
await wait(100);
const fuzzy = await firstItems(5);
ok("query 'Other' → Other on top (fuzzy), even though Pinme is pinned", fuzzy[0] === "ZZP Other Command", JSON.stringify(fuzzy));
ok("the pinned-but-non-matching Pinme is fuzzy-filtered OUT", !fuzzy.includes("ZZP Pinme Command"), JSON.stringify(fuzzy));
await closeModal();

console.log("— a command that is BOTH pinned and recent renders exactly ONCE (in the pinned tier) —");
await openCmdPaletteSettings();
await page.fill('[data-testid="cmdpalette-add-input"]', "Recent");
await wait(80);
await page.click('[data-testid="cmdpalette-add-item"][data-id="r142:recent"]'); // now pinned AND recent
await wait(60);
await closeModal();
await openPalette();
const recentCount = await app(() => [...document.querySelectorAll('[data-testid="palette-item"] .palette-item-name')].filter((e) => e.textContent === "ZZP Recent Command").length);
ok("a pinned∩recent command renders exactly once (no dup / React key collision)", recentCount === 1, `count=${recentCount}`);
const top2b = await firstItems(2);
ok("both pins (Pinme, Recent) occupy the top two slots", top2b.includes("ZZP Pinme Command") && top2b.includes("ZZP Recent Command"), JSON.stringify(top2b));
await closeModal();

console.log("— a pinned id that is no longer registered is skipped (no crash) —");
await app(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith("geode.cmdPinned:"));
  const arr = JSON.parse(localStorage.getItem(k));
  localStorage.setItem(k, JSON.stringify(["r142:ghost-unregistered", ...arr])); // inject a dead pinned id
});
await openPalette();
const afterGhost = await firstItems(2);
ok("a dead pinned id is skipped, the live pins still lead", afterGhost.includes("ZZP Pinme Command") || afterGhost.includes("ZZP Recent Command"), JSON.stringify(afterGhost));
ok("no crash from the unregistered pinned id", pageErrors.length === 0, pageErrors.join(" | "));
await closeModal();

console.log("— unpinning via Settings removes it from the list and from the palette top —");
await openCmdPaletteSettings();
await page.click('[data-testid="cmdpalette-unpin-r142:pin"]');
await wait(60);
ok("the unpinned row is gone from the Pinned commands list", !(await page.isVisible('[data-testid="cmdpalette-pinned-row-r142:pin"]')));
ok("localStorage no longer holds the unpinned id", await app(() => Object.keys(localStorage).filter((k) => k.startsWith("geode.cmdPinned:")).every((k) => !JSON.parse(localStorage.getItem(k)).includes("r142:pin"))));
await closeModal();
await openPalette();
const afterUnpin = await firstItems(1);
ok("after unpin, Recent (still pinned) leads; Pinme no longer pinned-first", afterUnpin[0] === "ZZP Recent Command", JSON.stringify(afterUnpin));
await closeModal();

console.log("— pins persist across a reload (per-vault localStorage) —");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await registerCommands();
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await addTestCommands();
await openPalette();
const afterReload = await firstItems(1);
ok("after reload, the persisted pin (Recent) is still first", afterReload[0] === "ZZP Recent Command", JSON.stringify(afterReload));
await closeModal();

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR142 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
