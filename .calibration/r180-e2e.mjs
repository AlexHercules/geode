/**
 * R180 — G4-b: "Reveal active file in navigation" command — browser :1420.
 * Run: node .calibration/r180-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 180 additions" (G4-b).
 *
 * Obsidian "Reveal active file in navigation": when the active file lives in a
 * collapsed folder (opened via quick switcher / a link), this command expands
 * its ancestors, selects it, and scrolls it into view in the file explorer.
 * Pure UI (expand/select/scroll) — no vault write. Uses the workspace
 * revealInExplorer one-shot Store (revealTarget R14 shape), consumed by Explorer.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r180", name: "r180", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (sel) => app(([s]) => !!document.querySelector(s), [sel]);
const rowSel = (p) => `[data-testid="explorer"] [data-testid="explorer-item"][data-path="${p}"]`;

const DIR = "r180-dir";
const FILE = "r180-dir/r180-note.md";

// seed a folder + nested file; folders are collapsed by default
await app(async ([dir, file]) => {
  try { await window.__app.vault.createFolder(dir); } catch { /* exists */ }
  try { await window.__app.vault.create(file, "# r180\n"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 60));
}, [DIR, FILE]);
await wait(300);

console.log("— precondition: folder collapsed, nested file row not rendered —");
ok("folder row present", await has(rowSel(DIR)));
ok("nested file row NOT yet in DOM (collapsed)", !(await has(rowSel(FILE))));

console.log("— open the file (active) without revealing it in the tree —");
await app(([file]) => window.__app.workspace.openFile(file), [FILE]);
await wait(200);
ok("file is now the active file", (await app(() => window.__app.workspace.getActiveFile())) === FILE);
ok("but its row is still not in the tree (no auto-reveal)", !(await has(rowSel(FILE))));

console.log("— run the reveal command —");
const execResult = await app(() => window.__app.commands.execute("file-explorer:reveal-active-file"));
ok("command executes", execResult === true || execResult === undefined, JSON.stringify(execResult));
await wait(250);
ok("left panel switched to explorer", (await app(() => window.__app.workspace.state.get().leftPanel)) === "explorer");
ok("nested file row now rendered (ancestors expanded)", await has(rowSel(FILE)));
ok("revealed file row is selected (is-selected)", await app(([s]) =>
  document.querySelector(s)?.classList.contains("is-selected") === true, [rowSel(FILE)]));
ok("one-shot store cleared after consume", (await app(() => window.__app.workspace.revealInExplorer.get())) === null);

console.log("— available() gating: false when no active file —");
await app(() => window.__app.workspace.openGraph());
await wait(150);
ok("graph tab → no active markdown file", (await app(() => window.__app.workspace.getActiveFile())) === null);
ok("command available() is false with no active file", await app(() => {
  const cmd = window.__app.commands.list().find((c) => c.id === "file-explorer:reveal-active-file");
  return cmd?.available?.() === false;
}));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR180: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
