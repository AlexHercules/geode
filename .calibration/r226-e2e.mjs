/**
 * R226 editor "Right-to-left" (RTL) toggle E2E — browser mode :1420.
 * Run: node .calibration/r226-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 226 additions".
 *
 * Obsidian's "Right-to-left" (default OFF) sets the editor + reading-view default text direction
 * to RTL. Geode applies it as a pure DOM attr: the CM contentDOM `dir` (CM6 native bidi takes over)
 * + the preview div `dir`. No edit-logic / byte change. Persisted via a global appearance Store.
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
await page.evaluate(() => { try { localStorage.removeItem("geode.rightToLeft"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r226", name: "r226", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FN = "rtl.md";
const setMode = (m) => app(([mode]) => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, mode); }, [m]);
const openEditor = async () => {
  await app(async () => {
    try { await window.__app.vault.create("rtl.md", "# عنوان\n\nשלום world\n"); } catch { /* exists (memory vault reset on reload) */ }
    window.__app.workspace.openFile("rtl.md");
    const t = window.__app.workspace.getActiveTab();
    window.__app.workspace.setTabMode(t.id, "live");
  });
  await page.waitForSelector(".cm-content", { timeout: 4000 });
  await wait(120);
};
const cmDir = () => app(() => document.querySelector(".cm-content")?.getAttribute("dir") ?? "(none)");
const previewDir = () => app(() => document.querySelector('[data-testid="preview"]')?.getAttribute("dir") ?? "(none)");
const toggleRtl = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-editor"]');
  await wait(80);
  await page.waitForSelector("[data-testid=settings-rtl-toggle]", { timeout: 3000 });
  await page.click("[data-testid=settings-rtl-toggle]");
  await wait(80);
  await app(() => window.__app.workspace.closeModal());
  await wait(80);
};

await openEditor();

console.log("— default OFF: editor direction is LTR —");
ok("default OFF: .cm-content dir='ltr'", (await cmDir()) === "ltr", await cmDir());

console.log("— toggle ON: editor + reading view become RTL —");
await toggleRtl();
ok("ON: .cm-content dir='rtl' (live editor)", (await cmDir()) === "rtl", await cmDir());
await setMode("preview");
await page.waitForSelector('[data-testid="preview"]', { timeout: 4000 });
await wait(120);
ok("ON: preview div dir='rtl' (reading view)", (await previewDir()) === "rtl", await previewDir());
ok("the pref persisted to localStorage as 'true'", (await app(() => localStorage.getItem("geode.rightToLeft"))) === "true");

console.log("— OFF persists across reload —");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r226b", name: "r226b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await openEditor();
ok("after reload, RTL restored → .cm-content dir='rtl'", (await cmDir()) === "rtl", await cmDir());

console.log("— toggle back OFF: returns to LTR —");
await toggleRtl();
ok("back OFF: .cm-content dir='ltr'", (await cmDir()) === "ltr", await cmDir());
ok("the pref persisted as 'false'", (await app(() => localStorage.getItem("geode.rightToLeft"))) === "false");

console.log("— bytes are untouched: RTL is visual-only —");
const bytes = await app(() => window.__app.documents.get("rtl.md")?.getText() ?? "(not open)");
ok("doc bytes unchanged by the RTL toggling (visual only)", bytes === "# عنوان\n\nשלום world\n", JSON.stringify(bytes));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR226 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
