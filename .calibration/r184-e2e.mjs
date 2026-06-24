/**
 * R184 — G3 (ui-only→done): file-op COMMANDS (duplicate / rename / move / new-folder)
 * routing the active file to the Explorer's vetted handlers — browser :1420.
 * Run: node .calibration/r184-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 184 additions" (G3 ui-only→done remainder).
 *
 * The matrix marked these ui-only (right-click/button only). R184 promotes them to
 * commands operating on the ACTIVE file via a one-shot workspace.explorerFileAction
 * store the Explorer consumes → makeCopy(R42) / startRename(R16) / setMovePath(R28) /
 * newFolder(R17). Writes go through the SAME vetted paths as the right-click menu.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r184", name: "r184", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (sel) => app(([s]) => !!document.querySelector(s), [sel]);
const exec = (id) => app(([cid]) => window.__app.commands.execute(cid), [id]);
const fileExists = (p) => app(([x]) => window.__app.vault.fileExists(x), [p]);
const folderExists = (p) => app(([x]) => window.__app.vault.folderExists(x), [p]);

await app(async () => {
  for (const f of ["r184-dup.md", "r184-ren.md", "r184-mov.md"]) {
    try { await window.__app.vault.create(f, "# " + f + "\n"); } catch { /* exists */ }
  }
  await new Promise((r) => setTimeout(r, 60));
});
await wait(250);

const IDS = ["file-explorer:duplicate-file", "workspace:edit-file-title", "file-explorer:move-file", "file-explorer:new-folder"];

console.log("— all 4 commands registered + names resolve + gating —");
const reg = await app(([ids]) => ids.map((id) => {
  const c = window.__app.commands.list().find((x) => x.id === id);
  return { id, present: !!c, name: c ? c.name() : null, gated: c ? typeof c.available === "function" : false };
}), [IDS]);
for (const r of reg) {
  ok(`${r.id} registered`, r.present);
  ok(`${r.id} name resolves`, !!r.name && !r.name.startsWith("explorer."), r.name);
}
ok("3 file-ops are active-file gated; new-folder is not", await app(([ids]) => {
  const g = (id) => window.__app.commands.list().find((x) => x.id === id);
  return ["file-explorer:duplicate-file", "workspace:edit-file-title", "file-explorer:move-file"].every((id) => typeof g(id).available === "function")
    && (g("file-explorer:new-folder").available === undefined);
}, [IDS]));

console.log("— duplicate-file → vetted makeCopy creates '<name> 1.md' —");
await app(() => window.__app.workspace.openFile("r184-dup.md"));
await wait(150);
await exec("file-explorer:duplicate-file");
await wait(250);
ok("duplicate created 'r184-dup 1.md' (vault write via makeCopy)", await fileExists("r184-dup 1.md"));
ok("original untouched (still exists)", await fileExists("r184-dup.md"));

console.log("— rename → Explorer opens inline rename input on the active file —");
await app(() => window.__app.workspace.openFile("r184-ren.md"));
await wait(150);
await exec("workspace:edit-file-title");
await wait(200);
ok("inline rename input shown", await has('[data-testid="explorer-rename-input"]'));
ok("rename input targets the active file's row", await app(() => {
  const inp = document.querySelector('[data-testid="explorer-rename-input"]');
  const row = inp?.closest('[data-testid="explorer-item"]');
  return row?.getAttribute("data-path") === "r184-ren.md";
}));
await page.keyboard.press("Escape");
await wait(80);
ok("Escape cancels rename (input gone, file unchanged)", !(await has('[data-testid="explorer-rename-input"]')) && (await fileExists("r184-ren.md")));

console.log("— move → Explorer opens the Move-to modal —");
await app(() => window.__app.workspace.openFile("r184-mov.md"));
await wait(150);
await exec("file-explorer:move-file");
await wait(200);
ok("move-to modal shown", await has('[data-testid="move-to-modal"]'));
await page.keyboard.press("Escape");
await wait(80);
ok("Escape closes move modal (file unchanged)", !(await has('[data-testid="move-to-modal"]')) && (await fileExists("r184-mov.md")));

console.log("— new-folder → vetted newFolder creates a folder + opens its rename input —");
await exec("file-explorer:new-folder");
await wait(250);
ok("a 'New folder' was created (vault write via createFolder)", await folderExists("New folder"));
ok("new folder's rename input shown", await has('[data-testid="explorer-rename-input"]'));
await page.keyboard.press("Escape");
await wait(80);

console.log("— StrictMode mount-path: duplicate fires ONCE when command mounts Explorer —");
// switch left panel OFF explorer so the command's setLeftPanel('explorer') REMOUNTS it
// → consumer effect runs on mount (StrictMode double-invokes effects on mount in dev).
// With the fresh-read guard, the write-causing action must run exactly once.
await app(async () => {
  try { await window.__app.vault.create("r184-mnt.md", "# mnt\n"); } catch { /* exists */ }
  window.__app.workspace.openFile("r184-mnt.md");
  window.__app.workspace.setLeftPanel("search"); // unmount Explorer
});
await wait(200);
await exec("file-explorer:duplicate-file"); // setLeftPanel('explorer') remounts Explorer
await wait(300);
ok("duplicate created exactly one copy 'r184-mnt 1.md'", await fileExists("r184-mnt 1.md"));
ok("NO spurious second copy 'r184-mnt 2.md' (single fire under StrictMode mount)", !(await fileExists("r184-mnt 2.md")));

console.log("— gating: file-ops unavailable with no active file (graph) —");
await app(() => window.__app.workspace.openGraph());
await wait(120);
ok("duplicate/rename/move available()===false with no active file", await app(() =>
  ["file-explorer:duplicate-file", "workspace:edit-file-title", "file-explorer:move-file"].every((id) =>
    window.__app.commands.list().find((x) => x.id === id)?.available?.() === false)));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR184: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
