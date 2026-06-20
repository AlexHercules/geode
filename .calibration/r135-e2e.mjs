/**
 * R135 MarkdownPostProcessorContext addChild + getSectionInfo E2E — browser mode :1420.
 * Run: node .calibration/r135-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 135 additions".
 *
 *  A. live preview: a code-block handler's ctx.addChild(child) loads the child; entering the fence
 *     (widget destroyed) unloads it; leaving re-renders + loads a fresh child. ctx.getSectionInfo(el)
 *     returns {text, lineStart, lineEnd} from CM line info.
 *  B. reading view: a post-processor's ctx.addChild loads a child; leaving preview unloads it.
 *     ctx.getSectionInfo returns null (DOM→source mapping is the deferred §C half).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r135", name: "r135", onload(app) { window.__app = app; } }));
await page.waitForFunction(
  () => !!window.__app && typeof window.__geodeRegisterMarkdownCodeBlockProcessor === "function"
    && typeof window.__geodeRegisterMarkdownPostProcessor === "function",
  null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lcWidgets = () => page.locator('.cm-live-codeblock-lcblock').count();
const selectAt = (n) => app(([a]) => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: a } }); }, [n]);

// ── A. live preview: addChild lifecycle + getSectionInfo ──────────────────────
console.log("A. live preview — addChild lifecycle + getSectionInfo");
const DOC = "# Title\n\n```lcblock\nalpha\nbeta\n```\n\nend\n";
const SRC = "r135-live.md";
await app(() => {
  window.__live = { loaded: 0, unloaded: 0, section: null };
  window.__lcDispose = window.__geodeRegisterMarkdownCodeBlockProcessor("lcblock", (body, el, ctx) => {
    ctx.addChild({ load() { window.__live.loaded++; }, unload() { window.__live.unloaded++; } });
    window.__live.section = ctx.getSectionInfo(el);
    el.className = "cm-live-codeblock cm-live-codeblock-lcblock";
    el.textContent = "LC:" + body;
  });
});
await app(async ([p, d]) => { try { await window.__app.vault.create(p, d); } catch { /* exists */ } await new Promise((r) => setTimeout(r, 40)); }, [SRC, DOC]);
await app(async ([p]) => {
  window.__app.workspace.openFile(p);
  window.__app.workspace.setTabMode(window.__app.workspace.getActiveTab().id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, [SRC]);
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await wait(60);
await selectAt(0);
await wait(200);

ok("the ```lcblock fence rendered as a live widget", (await lcWidgets()) === 1, `n=${await lcWidgets()}`);
const liveAfterRender = await app(() => ({ ...window.__live }));
ok("ctx.addChild loaded the child once (load fired)", liveAfterRender.loaded === 1, JSON.stringify(liveAfterRender.loaded));
ok("the child has NOT unloaded yet", liveAfterRender.unloaded === 0, JSON.stringify(liveAfterRender.unloaded));
const sec = liveAfterRender.section;
ok("ctx.getSectionInfo returned a section object", sec && typeof sec === "object", JSON.stringify(sec));
ok("getSectionInfo.text is the FULL note source", sec && sec.text === DOC, JSON.stringify(sec && sec.text));
ok("getSectionInfo.lineStart is the fence's first line (0-based = 2)", sec && sec.lineStart === 2, JSON.stringify(sec && sec.lineStart));
ok("getSectionInfo.lineEnd is the closing-fence line (0-based = 5)", sec && sec.lineEnd === 5, JSON.stringify(sec && sec.lineEnd));

// cursor INTO the fence → widget destroyed → child unloaded
const lcFrom = await app(([p]) => (window.__app.documents.get(p)?.getText() ?? "").indexOf("```lcblock"), [SRC]);
await selectAt(lcFrom + 5);
await wait(200);
ok("entering the fence destroys the widget", (await lcWidgets()) === 0, `n=${await lcWidgets()}`);
ok("widget destroy unloaded the child (onunload fired)", (await app(() => window.__live.unloaded)) === 1, JSON.stringify(await app(() => window.__live.unloaded)));

// cursor back out → re-render → a FRESH child loads
await selectAt(0);
await wait(200);
ok("leaving the fence re-renders the widget", (await lcWidgets()) === 1, `n=${await lcWidgets()}`);
ok("the re-render loaded a fresh child (load count = 2)", (await app(() => window.__live.loaded)) === 2, JSON.stringify(await app(() => window.__live.loaded)));
await app(() => window.__lcDispose());

// ── B. reading view: addChild lifecycle + getSectionInfo null ────────────────
console.log("B. reading view — addChild lifecycle + getSectionInfo null (§C deferred)");
await app(() => {
  window.__rv = { loaded: 0, unloaded: 0, section: "unset" };
  window.__rvDispose = window.__geodeRegisterMarkdownPostProcessor((el, ctx) => {
    ctx.addChild({ load() { window.__rv.loaded++; }, unload() { window.__rv.unloaded++; } });
    window.__rv.section = ctx.getSectionInfo(el);
  });
});
await app(async ([p]) => {
  try { await window.__app.vault.create(p, "# Reading\n\nsome text\n"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
  window.__app.workspace.openFile(p);
  window.__app.workspace.setTabMode(window.__app.workspace.getActiveTab().id, "preview");
  await new Promise((r) => setTimeout(r, 250));
}, ["r135-read.md"]);
await page.waitForSelector(".preview-content", { state: "attached", timeout: 5000 });
await wait(150);
ok("a reading-view post-processor's ctx.addChild loaded the child", (await app(() => window.__rv.loaded)) >= 1, JSON.stringify(await app(() => window.__rv.loaded)));
ok("reading-view ctx.getSectionInfo returns null (§C deferred, faithful)", (await app(() => window.__rv.section)) === null, JSON.stringify(await app(() => window.__rv.section)));

// leaving preview (→ live) tears down the render → child unloads
const beforeUnload = await app(() => window.__rv.unloaded);
await app(() => { window.__app.workspace.setTabMode(window.__app.workspace.getActiveTab().id, "live"); });
await wait(250);
ok("leaving preview unloaded the reading-view child (onunload fired)", (await app(() => window.__rv.unloaded)) > beforeUnload, `${await app(() => window.__rv.unloaded)} vs ${beforeUnload}`);
await app(() => window.__rvDispose());

// ── C. review MAJOR: addChild AFTER teardown (async handler) must NOT load the late child ──────
console.log("C. async addChild after teardown does NOT load a leaked child (review MAJOR fix)");
await app(() => {
  window.__late = { loaded: 0, unloaded: 0, resolve: null };
  window.__lateDispose = window.__geodeRegisterMarkdownCodeBlockProcessor("lateblock", async (body, el, ctx) => {
    el.className = "cm-live-codeblock cm-live-codeblock-lateblock";
    el.textContent = "LATE";
    await new Promise((res) => { window.__late.resolve = res; }); // block until the test resolves
    ctx.addChild({ load() { window.__late.loaded++; }, unload() { window.__late.unloaded++; } });
  });
});
const LATE_SRC = "r135-late.md";
await app(async ([p]) => {
  try { await window.__app.vault.create(p, "# L\n\n```lateblock\nx\n```\n"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
  window.__app.workspace.openFile(p);
  window.__app.workspace.setTabMode(window.__app.workspace.getActiveTab().id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, [LATE_SRC]);
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await wait(60);
await selectAt(0);
await wait(200);
ok("the async handler started + is awaiting (resolve captured, addChild not yet called)", (await app(() => typeof window.__late.resolve === "function" && window.__late.loaded === 0)) === true);
// cursor INTO the fence → widget destroyed → owner.unload() (owner now dead) BEFORE the handler resolves
const lateFrom = await app(([p]) => (window.__app.documents.get(p)?.getText() ?? "").indexOf("```lateblock"), [LATE_SRC]);
await selectAt(lateFrom + 5);
await wait(200);
// now let the in-flight handler resolve → it calls ctx.addChild on the torn-down owner
await app(() => window.__late.resolve());
await wait(200);
ok("addChild after teardown did NOT load the late child (no leak)", (await app(() => window.__late.loaded)) === 0, JSON.stringify(await app(() => window.__late.loaded)));
ok("the never-loaded late child was not unloaded either", (await app(() => window.__late.unloaded)) === 0, JSON.stringify(await app(() => window.__late.unloaded)));
await app(() => window.__lateDispose());

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR135 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
