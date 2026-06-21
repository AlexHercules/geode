/**
 * R172 compat MarkdownPreviewRenderer (static post-processor class) E2E — browser mode :1420.
 * Run: node .calibration/r172-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 172 additions" (Tier 8 D11 · static post-processor surface).
 *
 * obsidian.MarkdownPreviewRenderer is a STATIC class:
 *   - registerPostProcessor(pp, sortOrder?)   → routes into the SAME core registry as
 *     Plugin.registerMarkdownPostProcessor (R132); reading view applies it to .preview-content.
 *   - unregisterPostProcessor(pp)             → unregister by pp identity; re-render no longer runs it.
 *   - createCodeBlockPostProcessor(lang, h)   → PURE FACTORY returning (el, ctx) => void; when called,
 *     scans `pre > code.language-<lang>`, removes the <pre>, inserts a fresh <div>, calls h(source, div, ctx).
 *
 * The fixture (?obsfixture=1) onload exposes window.__obsidianMPR = obsidian.MarkdownPreviewRenderer.
 * registerPostProcessor must route into the core registry → reading view applies it (no vault write).
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

// 1) boot WITH the fixture (?obsfixture=1) so its onload runs and exposes __obsidianMPR
await page.goto(BASE_URL + "?obsfixture=1");
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(
  () => !!window.geode && !!window.app && !!window.__obsidianMPR,
  null,
  { timeout: 15000 },
);

const app = (fn, arg) => page.evaluate(fn, arg);

// acquire the GEODE-NATIVE app (its workspace exposes openFile/getActiveTab/setTabMode —
// the compat obsidian App shim's Obsidian-shaped workspace does NOT). Mirrors r132-e2e.
await app(() => window.geode.registerPlugin({ id: "r172", name: "r172", onload(a) { window.__app = a; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

console.log("— registerPostProcessor routes a static-registered pp into the reading-view pipeline —");
// 2) register a post-processor via the STATIC class, then open a note in preview mode
await app(() => {
  window.__r172pp = (el, ctx) => { el.setAttribute("data-r172", "1"); };
  window.__obsidianMPR.registerPostProcessor(window.__r172pp);
});
await app(async () => {
  try { await window.__app.vault.create("r172.md", "# H\n\nbody\n"); } catch { /* exists */ }
  window.__app.workspace.openFile("r172.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "preview");
});
await page.waitForSelector(".preview-content", { timeout: 5000 });
await page.waitForFunction(
  () => document.querySelector(".preview-content")?.getAttribute("data-r172") === "1",
  null,
  { timeout: 3000 },
).catch(() => {});

ok(
  ".preview-content carries data-r172='1' (static registration routed to core registry, reading view applied it)",
  (await app(() => document.querySelector(".preview-content")?.getAttribute("data-r172") ?? null)) === "1",
);

console.log("— unregisterPostProcessor: after unregister + forced re-render the transform is gone —");
// 3) unregister by pp identity, then force a fresh reading-view render (preview→live→preview)
await app(() => { window.__obsidianMPR.unregisterPostProcessor(window.__r172pp); });
await sleep(150); // dispose revision bump re-runs the effect (now without our pp)
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "live"); });
await sleep(200);
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "preview"); });
await page.waitForSelector(".preview-content", { timeout: 3000 });
await sleep(300);
ok(
  "the re-rendered .preview-content has NO data-r172 transform (unregister took effect)",
  (await app(() => document.querySelector(".preview-content")?.getAttribute("data-r172") ?? null)) === null,
);

console.log("— createCodeBlockPostProcessor: pure factory transforms `pre > code.language-<lang>` —");
// 4) pure factory test — runs against a synthetic host element, no reading view involved
const cb = await app(() => {
  const proc = window.__obsidianMPR.createCodeBlockPostProcessor("r172lang", (source, div, ctx) => {
    div.setAttribute("data-r172cb", "1");
    div.textContent = "CB:" + source;
  });
  const procType = typeof proc;
  const host = document.createElement("div");
  host.innerHTML = '<pre><code class="language-r172lang">hello</code></pre>';
  proc(host, { sourcePath: "x.md" });
  return {
    procType,
    hasPre: !!host.querySelector("pre"),
    cbDiv: host.querySelector("[data-r172cb]") ? host.querySelector("[data-r172cb]").textContent : null,
  };
});
ok("createCodeBlockPostProcessor returns a function (it is a factory, not a registration)", cb.procType === "function", cb.procType);
ok("the returned processor REMOVES the <pre> (host has no <pre> after running)", cb.hasPre === false, JSON.stringify(cb.hasPre));
ok("the handler ran into a fresh <div> with the extracted source ('CB:hello')", cb.cbDiv === "CB:hello", JSON.stringify(cb.cbDiv));

console.log("— no page errors throughout —");
ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR172 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
