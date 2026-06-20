/**
 * R132 compat Plugin.registerMarkdownPostProcessor E2E (phase 1, reading view) — browser mode :1420.
 * Run: node .calibration/r132-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 132 additions" (compat 商业主轴 · Dataview/Tasks 旗舰).
 *
 * Obsidian registerMarkdownPostProcessor((el, ctx) => …) — plugins transform the rendered reading
 * view. Geode bridges via a CORE registry (core/markdownPostProcessors): compat registers, the
 * EditorPane reading view applies each processor to the freshly-rendered .preview-content. Additive
 * (display-only): the markdown→HTML byte rendering (core/markdown.ts) is untouched, no vault write.
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r132", name: "r132", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && typeof window.__geodeRegisterMarkdownPostProcessor === "function", null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);

// register two post-processors: A (default order) marks the DOM + records ctx; B (sortOrder -10) runs first
await app(() => {
  window.__r132 = { order: [], path: null, fm: null, hasContainer: false };
  window.__r132disposeA = window.__geodeRegisterMarkdownPostProcessor((el, ctx) => {
    window.__r132.order.push("A");
    window.__r132.path = ctx.sourcePath;
    window.__r132.fm = ctx.frontmatter;
    window.__r132.hasContainer = ctx.containerEl === el;
    el.setAttribute("data-r132", "A");
    if (!el.querySelector(".r132-marker")) {
      const m = document.createElement("span");
      m.className = "r132-marker";
      m.textContent = "PP:" + ctx.sourcePath;
      el.appendChild(m);
    }
  });
  window.__r132disposeB = window.__geodeRegisterMarkdownPostProcessor((el, ctx) => { window.__r132.order.push("B"); }, -10);
});

// create + open a note WITH frontmatter in PREVIEW (reading) mode
await app(async () => {
  try { await window.__app.vault.create("pp.md", "---\ntitle: PP Note\n---\n# Heading\n\nbody paragraph\n"); } catch { /* exists */ }
  window.__app.workspace.openFile("pp.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "preview");
});
await page.waitForSelector(".preview-content", { timeout: 5000 });
await page.waitForSelector(".r132-marker", { timeout: 3000 }).catch(() => {});

console.log("— a registered post-processor runs on the rendered reading-view DOM —");
const res = await app(() => ({ ...window.__r132 }));
ok("post-processor A ran (recorded a call)", res.order.includes("A"), JSON.stringify(res.order));
ok(".preview-content carries the data-r132='A' transform", (await app(() => document.querySelector(".preview-content")?.getAttribute("data-r132") ?? null)) === "A");
ok("the post-processor appended its marker element to the rendered DOM", (await app(() => document.querySelector(".preview-content .r132-marker")?.textContent ?? null)) === "PP:pp.md");

console.log("— context: sourcePath / frontmatter / containerEl —");
ok("ctx.sourcePath === the note path (pp.md)", res.path === "pp.md", JSON.stringify(res.path));
ok("ctx.frontmatter === the parsed fields ({title: 'PP Note'})", eq(res.fm, { title: "PP Note" }), JSON.stringify(res.fm));
ok("ctx.containerEl === the element passed to the processor", res.hasContainer === true);

console.log("— sortOrder: lower runs first (B[-10] before A[0]) —");
ok("B ran before A (sortOrder ordering)", res.order.indexOf("B") !== -1 && res.order.indexOf("B") < res.order.indexOf("A"), JSON.stringify(res.order));

console.log("— disposer: after unregister, a re-render does NOT re-run the processors —");
const beforeLen = res.order.length;
await app(() => { window.__r132disposeA(); window.__r132disposeB(); });
await sleep(150); // the dispose revision bump re-runs the effect (now with an empty registry)
// force a fresh reading-view render (toggle live → preview) and confirm no new calls
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "live"); });
await sleep(200);
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "preview"); });
await page.waitForSelector(".preview-content", { timeout: 3000 });
await sleep(300);
const afterLen = await app(() => window.__r132.order.length);
ok("disposed processors do not run on re-render (order length stable)", afterLen === beforeLen, `before=${beforeLen} after=${afterLen}`);
ok("the re-rendered DOM has NO data-r132 transform (disposed)", (await app(() => document.querySelector(".preview-content")?.getAttribute("data-r132") ?? null)) === null);

console.log("— registering a processor while a preview is OPEN does NOT re-run on the un-wiped DOM (review MAJOR) —");
// a NON-idempotent appending processor, registered before opening a fresh note
await app(() => {
  window.__dupDispose = window.__geodeRegisterMarkdownPostProcessor((el) => {
    const n = document.createElement("span"); n.className = "r132-dup"; el.appendChild(n);
  });
});
await app(async () => {
  try { await window.__app.vault.create("pp2.md", "# fresh\n\nbody\n"); } catch { /* exists */ }
  window.__app.workspace.openFile("pp2.md");
  const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "preview");
});
await page.waitForSelector(".preview-content .r132-dup", { state: "attached", timeout: 5000 });
const dupBefore = await app(() => document.querySelectorAll(".preview-content .r132-dup").length);
ok("the appending processor ran once on a fresh open (1 node)", dupBefore === 1, JSON.stringify(dupBefore));
// register ANOTHER processor while the preview is open — must NOT re-run the dup processor on the un-wiped DOM
await app(() => { window.__dupDispose2 = window.__geodeRegisterMarkdownPostProcessor(() => {}); });
await sleep(300);
const dupAfter = await app(() => document.querySelectorAll(".preview-content .r132-dup").length);
ok("registering another processor while open does NOT duplicate (still 1 node, not 2)", dupAfter === 1, JSON.stringify(dupAfter));
await app(() => { window.__dupDispose(); window.__dupDispose2(); });

console.log(`\nR132 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
