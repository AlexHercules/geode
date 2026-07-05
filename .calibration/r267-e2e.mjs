/**
 * R267 — static `.app-container` wrapper around #root (Obsidian's outermost root class), so a
 * plugin's EAGER onload portal/popover (Calendar's Svelte `<Portal target=".app-container">`) finds
 * it even though Geode loads plugins BEFORE React commits the DOM (main.tsx order). Resolves the R266
 * onload transient WITHOUT reordering boot (which would break workspace-restore of plugin views) and
 * WITHOUT a React conflict (the wrapper is OUTSIDE #root, so a portal mounted into it never collides
 * with React's tree). R266's React-div `.app-container` class is reverted → single faithful wrapper.
 * Part A (always): wrapper DOM structure + layout intact.
 * Part B (Calendar, skipped if bundle absent): onload + view portals → 0 `.app-container` errors.
 * Run: node .calibration/r267-e2e.mjs   (dev server up)
 * Contract: docs/ARCHITECTURE.md "Round 267 additions".
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

// ---------- Part A: wrapper structure + layout ----------
console.log("— Part A: static .app-container wrapper + layout intact —");
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
  await wait(600);
  const s = await page.evaluate(() => {
    const wrap = document.querySelector("body > .app-container");
    const root = document.getElementById("root");
    const app = root ? root.querySelector(".app") : null;
    return {
      count: document.querySelectorAll(".app-container").length,
      wrapperWrapsRoot: !!wrap && !!root && wrap.contains(root),
      wrapperOutsideRoot: !!root && !root.querySelector(".app-container"),
      appHeight: app ? Math.round(app.getBoundingClientRect().height) : 0,
      workspace: !!document.querySelector(".sidebar, .workspace, .main"),
    };
  });
  ok("single .app-container (the faithful outermost wrapper)", s.count === 1, JSON.stringify(s));
  ok(".app-container wraps #root (exists from page load, before plugins)", s.wrapperWrapsRoot === true, JSON.stringify(s));
  ok(".app-container is OUTSIDE #root (no React-tree collision for mounted portals)", s.wrapperOutsideRoot === true, JSON.stringify(s));
  ok("layout intact — app fills the viewport (height ≈ 700, chain unbroken)", s.appHeight >= 680, JSON.stringify(s));
  ok("workspace renders (sidebar/main)", s.workspace === true);
  ok("Part A: no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.close();
}

// ---------- Part B: Calendar onload + view portals find .app-container (0 errors) ----------
if (!existsSync(join(CAL, "main.js"))) {
  console.log("— Part B SKIPPED: Calendar bundle absent —");
} else {
  console.log("— Part B: Calendar onload + view portals → 0 .app-container errors —");
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
  await wait(400); // let any eager onload portal mount
  const errsAfterLoad = errors.filter((e) => /app-container/.test(e)).length;
  ok("Calendar onload portal found .app-container — 0 errors at load (was 1, R266 transient fixed)", errsAfterLoad === 0, errors.slice(0, 2).join(" | "));

  const view = await page.evaluate(async () => {
    const leaf = window.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: "calendar", active: true });
    await new Promise((r) => setTimeout(r, 600));
    return { rendered: !!document.querySelector("table.calendar") };
  });
  ok("calendar Svelte view still renders (wrapper satisfies the view portal too)", view.rendered === true);
  ok("ZERO .app-container errors across load + view (R266 transient fully resolved)", errors.filter((e) => /app-container/.test(e)).length === 0, errors.slice(0, 2).join(" | "));
  ok("Part B: no other page errors", errors.filter((e) => !/app-container/.test(e)).length === 0, errors.filter((e) => !/app-container/.test(e)).slice(0, 2).join(" | "));
  await page.close();
}

console.log(`\nR267 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
