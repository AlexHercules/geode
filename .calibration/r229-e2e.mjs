/**
 * R229 editor "Show view mode toggle" setting E2E — browser mode :1420.
 * Run: node .calibration/r229-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 229 additions".
 *
 * Obsidian's "Show view mode toggle" (Editor, default ON) shows the per-tab edit/read toggle button.
 * Geode gates the Obsidian-style edit/read button on a persisted Store.
 * OFF hides the button but the mode is still switchable (setTabMode / Ctrl+E command).
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
await page.evaluate(() => { try { localStorage.removeItem("geode.showViewModeToggle"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r229", name: "r229", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hasToggle = () => app(() => !!document.querySelector('[data-testid="mode-reading-toggle"]'));
const activeMode = () => app(() => window.__app.workspace.getActiveTab()?.mode ?? null);
const openEditor = async () => {
  await app(async () => {
    try { await window.__app.vault.create("vm.md", "# hello\n\nbody\n"); } catch {}
    window.__app.workspace.openFile("vm.md");
    const t = window.__app.workspace.getActiveTab();
    window.__app.workspace.setTabMode(t.id, "live");
  });
  await page.waitForSelector(".cm-content", { timeout: 4000 });
  await wait(120);
};
const toggleViewMode = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-editor"]');
  await wait(80);
  await page.waitForSelector("[data-testid=settings-view-mode-toggle]", { timeout: 3000 });
  await page.click("[data-testid=settings-view-mode-toggle]");
  await wait(80);
  await app(() => window.__app.workspace.closeModal());
  await wait(80);
};

await openEditor();

console.log("— default ON: the view-mode toggle button is shown —");
ok("default ON: mode-reading-toggle is present", await hasToggle());
ok("settings toggle reflects default ON", await app(async () => {
  window.__app.workspace.openModal("settings");
  await new Promise((r) => setTimeout(r, 80));
  document.querySelector('[data-testid="settings-nav-editor"]')?.click();
  await new Promise((r) => setTimeout(r, 80));
  const v = document.querySelector("[data-testid=settings-view-mode-toggle]")?.getAttribute("aria-checked");
  window.__app.workspace.closeModal();
  return v;
}) === "true");
await page.click(".cm-content").catch(() => {});
await wait(40);

console.log("— toggle OFF: the button is hidden, but the mode is still switchable —");
await toggleViewMode();
ok("OFF: mode-reading-toggle is hidden", !(await hasToggle()));
// mode still switchable via the underlying mechanism (Ctrl+E command / setTabMode) despite no button
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "source"); });
await wait(100);
ok("OFF: the mode still switches to 'source' (logic not gated, only the button)", (await activeMode()) === "source");
ok("OFF: mode-reading-toggle still hidden after a mode switch", !(await hasToggle()));
ok("pref persisted to localStorage as 'false'", (await app(() => localStorage.getItem("geode.showViewModeToggle"))) === "false");

console.log("— OFF persists across reload —");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r229b", name: "r229b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await openEditor();
ok("after reload, OFF restored → mode-reading-toggle still hidden", !(await hasToggle()));

console.log("— toggle back ON: button returns —");
await toggleViewMode();
ok("back ON: mode-reading-toggle is shown again", await hasToggle());

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR229 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
