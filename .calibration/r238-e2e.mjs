/**
 * R238 editor:focus command E2E — browser mode :1420.
 * Run: node .calibration/r238-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 238 additions".
 *
 * Obsidian's "Focus on the editor" (editor:focus) moves keyboard focus to the active editor.
 * Geode registers it next to the fold commands: getActiveView()?.view.focus(). No default key.
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
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r238", name: "r238", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const activeInEditor = () => app(() => !!document.activeElement?.closest(".cm-content"));

console.log("— editor:focus is a registered command with the native name + no default key —");
ok("editor:focus is registered", await app(() => window.geode.app.commands.list().some((c) => c.id === "editor:focus")));
ok("its name is 'Focus on the editor'", await app(() => {
  const c = window.geode.app.commands.list().find((x) => x.id === "editor:focus");
  const n = typeof c.name === "function" ? c.name() : c.name;
  return n === "Focus on the editor";
}));
ok("no default hotkey", (await app(() => window.geode.app.commands.getEffectiveHotkey("editor:focus"))) === null);

console.log("— executing it moves keyboard focus into the active editor —");
await app(async () => {
  try { await window.__app.vault.create("r238.md", "# r238\nbody\n"); } catch {}
  window.__app.workspace.openFile("r238.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "source");
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await page.waitForFunction(() => !!window.__app.documents.getActiveView()?.view, null, { timeout: 4000 });
// blur the editor: move focus off the cm-content
await app(() => { const el = document.activeElement; if (el && el.blur) el.blur(); });
await wait(40);
ok("after blur, focus is NOT in the editor", !(await activeInEditor()));
await app(() => window.geode.app.commands.execute("editor:focus"));
await wait(60);
ok("editor:focus returns keyboard focus to the editor (.cm-content)", await activeInEditor());

console.log("— executing with no active editor view (graph tab) drives the null-guard, no throw —");
await app(() => window.__app.workspace.openGraph()); // fileless singleton → no active editor view
await wait(120);
ok("getActiveView() is null when the graph tab is active", (await app(() => window.__app.documents.getActiveView())) === null);
ok("editor:focus with no editor is a safe no-op (boolean, no throw)", (await app(() => typeof window.geode.app.commands.execute("editor:focus"))) === "boolean");
ok("focus did not jump into a (non-existent) editor", !(await activeInEditor()));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR238 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
