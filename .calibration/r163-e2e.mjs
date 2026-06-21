/**
 * R163 — Tier 7 B2: plugin settings "one plugin, one tab" left-nav IA — browser :1420.
 * Run: node .calibration/r163-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 163 additions" (Tier 7 B2).
 *
 * Each enabled plugin's settings section becomes its own left-nav entry; clicking
 * it renders only that plugin's display() (imperative mount/unmount). Pure frontend
 * IA rearrange over the existing settingsSections Store — zero writes.
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
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
// register an enabled plugin (window.geode.app = core app), then contribute a
// settings section for it via the core plugins registry (imperative mount)
await page.evaluate(async () => {
  const app = window.geode.app;
  window.__app = app;
  await window.geode.registerPlugin({ id: "r163", name: "R163 Test Plugin", onload() {} });
  app.plugins.addSettingsSection({
    id: "r163:settings:0",
    pluginId: "r163",
    name: "R163 Test Plugin",
    mount(el) { el.innerHTML = '<div data-testid="r163-settings-content">hello settings</div>'; },
    unmount() {},
  });
});
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NAV = '[data-testid="settings-nav-plugin-r163:settings:0"]';
const CONTENT = '[data-testid="r163-settings-content"]';
const present = (sel) => page.$(sel).then((h) => !!h);

await ev(() => window.__app.workspace.openModal("settings"));
await page.waitForSelector("[data-testid=settings-modal]", { timeout: 5000 });
await wait(80);

console.log("— per-plugin left-nav entry exists —");
ok("settings-nav-plugin entry present", await present(NAV));
ok("nav entry shows the plugin name", (await page.textContent(NAV))?.includes("R163 Test Plugin"));
ok("fixed sections still present (appearance/plugins/about)",
  (await present("[data-testid=settings-nav-appearance]")) &&
  (await present("[data-testid=settings-nav-plugins]")) &&
  (await present("[data-testid=settings-nav-about]")));

console.log("— old crammed collapsible block is gone —");
ok("no legacy plugin-settings-section block", await ev(() =>
  document.querySelector('[data-testid^="plugin-settings-section-"]') === null));

console.log("— plugin display() mounts only when its tab is selected —");
ok("plugin content NOT mounted on default (appearance) section", !(await present(CONTENT)));
await page.click(NAV);
await wait(80);
ok("nav entry active after click", await ev((s) =>
  document.querySelector(s)?.className.includes("is-active"), NAV));
ok("plugin display() content mounted in right pane", await present(CONTENT));
ok("right pane shows plugin name heading", await ev(() =>
  !!document.querySelector(".settings-content .settings-heading") &&
  document.querySelector(".settings-content .settings-heading").textContent.includes("R163 Test Plugin")));

console.log("— switching away unmounts; switching back remounts (no DOM leak) —");
await page.click("[data-testid=settings-nav-appearance]");
await wait(80);
ok("plugin content unmounted after switching to appearance", !(await present(CONTENT)));
await page.click(NAV);
await wait(80);
ok("plugin content remounted after switching back", await present(CONTENT));

console.log("— Plugins section no longer renders the settings blocks inline —");
await page.click("[data-testid=settings-nav-plugins]");
await wait(80);
ok("Plugins section active", await ev(() =>
  document.querySelector("[data-testid=settings-nav-plugins]")?.className.includes("is-active")));
ok("no inline plugin settings content under Plugins section", !(await present(CONTENT)));

console.log("— cross-plugin switching + live add + fallback when section removed —");
const NAVB = '[data-testid="settings-nav-plugin-r163b:settings:0"]';
const CONTENTB = '[data-testid="r163b-settings-content"]';
await ev(async () => {
  const app = window.geode.app;
  await window.geode.registerPlugin({ id: "r163b", name: "R163 Plugin B", onload() {} });
  window.__disposeB = app.plugins.addSettingsSection({
    id: "r163b:settings:0", pluginId: "r163b", name: "R163 Plugin B",
    mount(el) { el.innerHTML = '<div data-testid="r163b-settings-content">B</div>'; },
    unmount() {},
  });
});
await wait(80);
ok("2nd plugin's nav entry appears live (revision bump)", await present(NAVB));
await page.click(NAV); // select plugin A
await wait(80);
ok("plugin A content shown", await present(CONTENT));
await page.click(NAVB); // switch A→B
await wait(80);
ok("switching A→B unmounts A's content", !(await present(CONTENT)));
ok("switching A→B mounts B's content", await present(CONTENTB));
await ev(() => window.__disposeB()); // remove B's section while viewing it
await wait(100);
ok("removing the viewed plugin's section falls back to Plugins", await ev(() =>
  document.querySelector("[data-testid=settings-nav-plugins]")?.className.includes("is-active")));
ok("removed plugin's nav entry is gone", !(await present(NAVB)));
ok("removed plugin's content is gone", !(await present(CONTENTB)));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR163: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
