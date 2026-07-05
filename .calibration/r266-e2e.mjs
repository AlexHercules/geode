/**
 * R266 — a 3rd real plugin (Calendar 2.0, a VIEW + Svelte plugin) loads + its month-grid view
 * renders in Geode (商业主轴 breadth: a new surface vs Dataview queries / Templater templating).
 * Fix: Geode's root carries Obsidian's standard `.app-container` class (App.tsx) so plugins that
 * mount popovers/portals into it (Calendar's Svelte `<Portal target=".app-container">`) work.
 * Known transient (documented): Geode loads plugins in main.tsx BEFORE React commits .app-container
 * (load order), so Calendar's EAGER onload popover portal mounts once before .app-container exists —
 * one "No element found matching .app-container" at load. Non-fatal (view + commands work; the
 * VIEW's own popover finds .app-container post-render). Reordering boot is risky (workspace restore
 * of plugin views) → deferred. The suite asserts this is the ONLY tolerated error.
 * Calendar (gitignored, fetch to .calibration/calendar/ to run; else skipped):
 *   curl -sL -o .calibration/calendar/main.js https://github.com/liamcain/obsidian-calendar-plugin/releases/latest/download/main.js
 *   curl -sL -o .calibration/calendar/manifest.json https://github.com/liamcain/obsidian-calendar-plugin/releases/latest/download/manifest.json
 * Run: node .calibration/r266-e2e.mjs   (dev server up)
 * Contract: docs/ARCHITECTURE.md "Round 266 additions".
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const CAL = join(__dir, "calendar");
const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const browser = await chromium.launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(join(CAL, "main.js"))) {
  console.log("R266 SKIPPED: Calendar bundle not at .calibration/calendar/ (see header).");
  await browser.close();
  process.exit(0);
}

console.log("— Calendar 2.0 (VIEW + Svelte) loads + month-grid renders + .app-container fix —");
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.addInitScript(({ m, j }) => {
  window.__geodeObsidianPlugins = [{ dir: "calendar-beta", manifestJson: j, mainJs: m, stylesCss: null, dataJson: null }];
  window.__geodeObsidianConfig = { "community-plugins.json": '["calendar-beta"]' };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
}, { m: readFileSync(join(CAL, "main.js"), "utf8"), j: readFileSync(join(CAL, "manifest.json"), "utf8") });
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === "calendar-beta"), null, { timeout: 12000 });

const report = await page.evaluate(() => (window.geode.app.obsidianLoadReport.get() ?? []).find((r) => r.id === "calendar-beta"));
ok("Calendar 2.0 onload completed — status=enabled", report?.status === "enabled", JSON.stringify(report));

ok(".app-container present (Obsidian-standard root class added to Geode's app root)",
  (await page.evaluate(() => document.querySelectorAll(".app-container").length)) >= 1);

const cmds = await page.evaluate(() => (window.app.commands.listCommands?.() ?? []).map((c) => c.id).filter((id) => /calendar/i.test(id)));
ok("Calendar registered its commands (show-calendar-view, etc.)", cmds.includes("calendar-beta:show-calendar-view"), JSON.stringify(cmds));

// open the calendar view + assert the Svelte month-grid table renders
const view = await page.evaluate(async () => {
  let opened = null;
  try {
    const leaf = window.app.workspace.getRightLeaf ? window.app.workspace.getRightLeaf(false) : null;
    if (leaf && leaf.setViewState) { await leaf.setViewState({ type: "calendar", active: true }); opened = true; }
  } catch (e) { opened = "ERR:" + e.message; }
  await new Promise((r) => setTimeout(r, 600));
  const tbl = document.querySelector("table.calendar");
  return { opened, rendered: !!tbl, weeks: tbl ? tbl.querySelectorAll("tr").length : 0, hasWeekend: !!document.querySelector(".calendar .weekend, table.calendar col.weekend") };
});
ok("calendar view opened (setViewState type=calendar)", view.opened === true, JSON.stringify(view));
ok("Svelte month-grid <table.calendar> RENDERED with week rows", view.rendered === true && view.weeks > 1, JSON.stringify(view));

// the ONLY tolerated error is the documented load-order onload-portal transient
const appContainerErrs = errors.filter((e) => /app-container/.test(e));
const otherErrs = errors.filter((e) => !/app-container/.test(e));
ok("no errors other than the documented .app-container onload-portal transient", otherErrs.length === 0, otherErrs.slice(0, 2).join(" | "));
ok("the .app-container onload transient is at most 1 (load-order, view-portal fixed)", appContainerErrs.length <= 1, `count=${appContainerErrs.length}`);

console.log(`\nR266 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await page.close();
await browser.close();
process.exit(failed === 0 ? 0 : 1);
