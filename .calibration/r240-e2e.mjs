/**
 * R240 graph:open-local command E2E — browser mode :1420.
 * Run: node .calibration/r240-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 240 additions".
 *
 * Obsidian's "Open local graph" opens the graph anchored to the active note. GraphView already
 * supports local mode (R103/R110, anchor = lastActiveFile); R240 adds the command via a one-shot
 * request (set + openGraph) that GraphView consumes to flip prefs.mode to "local".
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
await page.evaluate(() => { try { localStorage.removeItem("geode.graphPrefs"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r240", name: "r240", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const graphMode = () => app(() => { try { return JSON.parse(localStorage.getItem("geode.graphPrefs") || "{}").mode; } catch { return null; } });
const activeViewType = () => app(() => window.__app.workspace.getActiveTab()?.viewType);

console.log("— graph:open-local is registered with the native name + no default key —");
ok("command registered", await app(() => window.geode.app.commands.list().some((c) => c.id === "graph:open-local")));
ok("name is 'Open local graph'", await app(() => {
  const c = window.geode.app.commands.list().find((x) => x.id === "graph:open-local");
  const n = typeof c.name === "function" ? c.name() : c.name;
  return n === "Open local graph";
}));
ok("no default hotkey", (await app(() => window.geode.app.commands.getEffectiveHotkey("graph:open-local"))) === null);

console.log("— path A: graph NOT open → the command opens it directly in local mode —");
await app(async () => {
  try { await window.__app.vault.create("anchorNote.md", "# anchor\n[[other]]\n"); } catch {}
  window.__app.workspace.openFile("anchorNote.md");
});
await wait(80);
ok("graph is not open before the command", (await activeViewType()) !== "graph");
await app(() => window.geode.app.commands.execute("graph:open-local"));
await wait(180);
ok("path A: the command opens the graph", (await activeViewType()) === "graph");
ok("path A: it opens in local mode", (await graphMode()) === "local", String(await graphMode()));
ok("the local anchor follows the active note (lastActiveFile)", (await app(() => window.__app.workspace.lastActiveFile.get())) === "anchorNote.md");

console.log("— path B: a global graph already open → the command switches it to local —");
// close the graph + reset persisted mode to global, then reopen it globally
await app(() => {
  const gt = window.__app.workspace.getPanes().flatMap((p) => p.tabs).find((t) => t.viewType === "graph");
  if (gt) window.__app.workspace.closeTab(gt.id);
  try { localStorage.setItem("geode.graphPrefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("geode.graphPrefs") || "{}"), mode: "global" })); } catch {}
});
await wait(80);
await app(() => window.geode.app.commands.execute("app:open-graph"));
await wait(150);
ok("path B setup: graph reopened in global mode", (await graphMode()) === "global", String(await graphMode()));
await app(() => window.geode.app.commands.execute("graph:open-local"));
await wait(160);
ok("path B: the command switches the open graph to local", (await graphMode()) === "local", String(await graphMode()));
ok("the graph tab is still active", (await activeViewType()) === "graph");

console.log("— running it again is idempotent (stays local, no error) —");
await app(() => window.geode.app.commands.execute("graph:open-local"));
await wait(120);
ok("still local after a second run", (await graphMode()) === "local");

console.log("— the local mode persists across reload (graphPrefs) —");
ok("graphPrefs persisted mode=local", (await graphMode()) === "local");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR240 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
