/**
 * R284 — 右侧日历默认显著性 + 主编辑区宽度对齐 Obsidian.
 * Browser :1420.   Run: node .calibration/r284-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 284 additions".
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r284", name: "r284", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("A. right sidebar calendar default salience");
const rightPanelDefault = await app(() => window.__app.workspace.state.get().rightPanel);
ok("default rightPanel is calendar", rightPanelDefault === "calendar", JSON.stringify(rightPanelDefault));
const calendarTabActive = await app(() => {
  const tab = document.querySelector('[data-testid="right-tab-calendar"]');
  return tab?.classList.contains("is-active") ?? false;
});
ok("calendar tab is active by default", calendarTabActive);
const calendarVisible = await app(() => !!document.querySelector('[data-testid="calendar-panel"]'));
ok("calendar panel is rendered by default", calendarVisible);

console.log("B. editor content width aligns to Obsidian 700px");
await app(() => window.__app.vault.create("R284.md", "# R284\nLine one.\n").catch(() => {}));
await wait(100);
await app(() => window.__app.workspace.openFile("R284.md"));
await wait(200);

const liveWidth = await app(() => {
  const el = document.querySelector(".cm-content");
  return el ? getComputedStyle(el).maxWidth : null;
});
ok("live editor .cm-content max-width is 700px", liveWidth === "700px", JSON.stringify(liveWidth));

await app(() => {
  const tab = window.__app.workspace.getActiveTab();
  if (tab) window.__app.workspace.setTabMode(tab.id, "preview");
});
await wait(250);
const previewWidth = await app(() => {
  const el = document.querySelector(".preview-content");
  return el ? getComputedStyle(el).maxWidth : null;
});
ok("reading view .preview-content max-width is 700px", previewWidth === "700px", JSON.stringify(previewWidth));

// verify skeleton matches the content column width
await app(() => {
  const tab = window.__app.workspace.getActiveTab();
  if (tab) window.__app.workspace.setTabMode(tab.id, "live");
});
await wait(200);
// open a non-existent file path to force a loading state? Instead evaluate a fresh pane render.
const skeletonWidth = await app(() => {
  // create a detached measurement host mirroring the editor-loading rules
  const host = document.createElement("div");
  host.className = "editor-loading";
  host.style.visibility = "hidden";
  host.style.position = "absolute";
  host.style.width = "100%";
  document.body.appendChild(host);
  const w = getComputedStyle(host).maxWidth;
  host.remove();
  return w;
});
ok(".editor-loading skeleton max-width is 700px", skeletonWidth === "700px", JSON.stringify(skeletonWidth));

console.log("C. readable-line OFF still yields full width");
await app(() => window.__geodeAppearance.setReadable(false));
await wait(150);
const liveWidthOff = await app(() => {
  const el = document.querySelector(".cm-content");
  return el ? getComputedStyle(el).maxWidth : null;
});
ok("readable OFF → .cm-content max-width is none", liveWidthOff === "none", JSON.stringify(liveWidthOff));
await app(() => window.__geodeAppearance.setReadable(true));
await wait(100);

// cleanup
await app(() => {
  if (window.__app.vault.fileExists("R284.md")) window.__app.vault.remove("R284.md");
});

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR284: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
