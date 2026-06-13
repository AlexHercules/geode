/**
 * R27 bookmarks E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r27-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 27 additions".
 *
 * Covers: panel mount + empty state; bookmark-file command toggle (label flips,
 * isFileBookmarked, panel row appears/disappears); heading-under-cursor command
 * stores Obsidian-shape subpath ("#Section") + click navigates + resolves span;
 * file bookmark click navigates; New-group button + group nesting via move();
 * persistence round-trip (reload from disk); DATA SAFETY: unknown top-level key
 * + unknown per-item field preserved across a write; malformed file is NOT
 * overwritten (fail-safe, never clobber Obsidian's data).
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
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r27", name: "r27", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeBookmarks, null, { timeout: 5000 });

const create = (p, c) => page.evaluate(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 50));
}, [p, c]);
const exec = (id) => page.evaluate(async (cid) => {
  window.__app.commands.execute(cid);
  await new Promise((r) => setTimeout(r, 120));
}, id);
const list = () => page.evaluate(() => window.__geodeBookmarks.list());

await create("Alpha.md", "# Alpha\n\nalpha body\n");
await create("Beta.md", "# Beta\n\nbeta body\n");
await create("Sectioned.md", "# Title\n\nintro\n\n## Section Two\n\nsection body here\n");

// ── panel mounts + empty state ──────────────────────────────────────────────
console.log("— panel mounts + empty state —");
await page.evaluate(() => window.__app.workspace.setLeftPanel("bookmarks"));
await page.waitForSelector("[data-testid=bookmarks-panel]", { timeout: 4000 }).catch(() => {});
ok("bookmarks panel mounts", (await page.$("[data-testid=bookmarks-panel]")) !== null);
ok("empty state shown initially", (await page.$("[data-testid=bookmarks-empty]")) !== null);

// ── bookmark-file command: toggle on ────────────────────────────────────────
console.log("— bookmark-file command (toggle on/off) —");
await page.evaluate(() => window.__app.workspace.openFile("Alpha.md"));
await page.waitForTimeout(150);
await exec("bookmarks:bookmark-file");
ok("isFileBookmarked(Alpha.md) true after command", await page.evaluate(() => window.__geodeBookmarks.list().some((b) => b.type === "file" && b.path === "Alpha.md")));
await page.waitForSelector("[data-testid=bookmark-item]", { timeout: 3000 }).catch(() => {});
ok("panel shows one bookmark-item row", (await page.$$("[data-testid=bookmark-item]")).length === 1);
// command name flips to the "remove" verb when already bookmarked
const flipName = await page.evaluate(() => {
  const c = window.__app.commands.list().find((x) => x.id === "bookmarks:bookmark-file");
  return typeof c.name === "function" ? c.name() : c.name;
});
ok("command label flips to unbookmark verb", /remove/i.test(flipName), flipName);

// ── bookmark-file command: toggle off ───────────────────────────────────────
await exec("bookmarks:bookmark-file");
ok("toggle off removes the file bookmark", (await list()).length === 0);
ok("empty state returns after removal", (await page.$("[data-testid=bookmarks-empty]")) !== null);

// ── heading-under-cursor command (Obsidian-shape subpath) ───────────────────
console.log("— bookmark heading under cursor —");
await page.evaluate(() => {
  const ws = window.__app.workspace;
  ws.openFile("Sectioned.md");
  const tab = ws.getActiveTab();
  ws.setTabMode(tab.id, "live");
});
await page.waitForTimeout(200);
// drop the cursor inside the "## Section Two" region (end of doc = last heading)
await page.evaluate(() => {
  const av = window.__app.documents.getActiveView();
  const end = av.view.state.doc.length;
  av.view.dispatch({ selection: { anchor: end } });
});
await exec("bookmarks:bookmark-heading");
const headingItem = await page.evaluate(() => window.__geodeBookmarks.list().find((b) => b.type === "heading"));
ok("heading bookmark created", !!headingItem);
ok("heading subpath is Obsidian-shape (#Section Two)", headingItem && headingItem.subpath === "#Section Two", JSON.stringify(headingItem));
ok("heading subpath resolves (strip # → span)", await page.evaluate(() => {
  const s = window.__app.metadata.resolveSubpath("Sectioned.md", "Section Two");
  return s !== null && s.kind === "heading";
}));

// ── click navigation: file bookmark opens the file ──────────────────────────
console.log("— click navigation —");
await page.evaluate(() => window.__geodeBookmarks.toggleFile("Beta.md")); // add Beta file bookmark
await page.evaluate(() => window.__app.workspace.openFile("Alpha.md"));   // move away
await page.waitForTimeout(120);
await page.evaluate(() => window.__app.workspace.setLeftPanel("bookmarks"));
await page.waitForTimeout(120);
// click the Beta file row (find by data-bm-path among file rows)
const clicked = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("[data-testid=bookmark-item]"));
  const list = window.__geodeBookmarks.list();
  const betaIdx = list.findIndex((b) => b.type === "file" && b.path === "Beta.md");
  const row = rows.find((r) => r.getAttribute("data-bm-path") === JSON.stringify([betaIdx]));
  if (!row) return false;
  row.click();
  return true;
});
await page.waitForTimeout(150);
ok("clicked Beta bookmark row", clicked);
ok("clicking file bookmark navigates to Beta.md", (await page.evaluate(() => window.__app.workspace.getActiveFile())) === "Beta.md");

// ── New group button + nesting via move() ───────────────────────────────────
console.log("— groups + move (nesting) —");
const beforeGroups = (await list()).filter((b) => b.type === "group").length;
await page.click("[data-testid=bookmarks-new-group]");
await page.waitForTimeout(150);
const afterGroups = (await list()).filter((b) => b.type === "group").length;
ok("New group button adds a group", afterGroups === beforeGroups + 1);
ok("group row rendered", (await page.$("[data-testid=bookmark-group]")) !== null);
// move the Beta file into the new group (group is the last top-level item)
const moveResult = await page.evaluate(async () => {
  const list = window.__geodeBookmarks.list();
  const groupIdx = list.findIndex((b) => b.type === "group");
  const betaIdx = list.findIndex((b) => b.type === "file" && b.path === "Beta.md");
  // move Beta INTO the group (toGroup = [groupIdx], toIndex = end of group)
  await window.__geodeBookmarks.move([betaIdx], [groupIdx], 0);
  await new Promise((r) => setTimeout(r, 120));
  const after = window.__geodeBookmarks.list();
  const grp = after.find((b) => b.type === "group");
  return { nested: !!grp && grp.items.some((c) => c.type === "file" && c.path === "Beta.md"),
           topHasBeta: after.some((b) => b.type === "file" && b.path === "Beta.md") };
});
ok("Beta moved INTO the group", moveResult.nested, JSON.stringify(moveResult));
ok("Beta no longer at top level", !moveResult.topHasBeta);

// ── persistence round-trip ──────────────────────────────────────────────────
console.log("— persistence round-trip (reload from disk) —");
const beforeReload = await list();
await page.evaluate(() => window.__geodeBookmarks.reload());
await page.waitForTimeout(150);
const afterReload = await list();
ok("item count survives reload", afterReload.length === beforeReload.length, `${afterReload.length} vs ${beforeReload.length}`);
ok("heading subpath survives reload", afterReload.some((b) => b.type === "heading" && b.subpath === "#Section Two"));

// ── DATA SAFETY: preserve unknown top-level key + unknown item field ─────────
console.log("— data safety: preserve unknown keys across a write —");
await page.evaluate(async () => {
  const seeded = {
    items: [{ type: "file", path: "Alpha.md", ctime: 111, geodeUnknownField: "keep-me" }],
    obsidianTopLevelThing: { foo: 42 },
  };
  await window.__app.vault.adapter.writeConfig("bookmarks.json", JSON.stringify(seeded));
  await window.__geodeBookmarks.reload();
  await new Promise((r) => setTimeout(r, 120));
});
// trigger a write (toggle a different file on)
await page.evaluate(async () => { await window.__geodeBookmarks.toggleFile("Beta.md"); await new Promise((r) => setTimeout(r, 120)); });
const rawAfter = await page.evaluate(() => window.__app.vault.adapter.readConfig("bookmarks.json"));
let parsed = null;
try { parsed = JSON.parse(rawAfter); } catch { /* leave null */ }
ok("unknown TOP-LEVEL key preserved across write", !!parsed && parsed.obsidianTopLevelThing && parsed.obsidianTopLevelThing.foo === 42, rawAfter?.slice(0, 80));
ok("unknown PER-ITEM field preserved across write", !!parsed && Array.isArray(parsed.items) && parsed.items.some((i) => i.geodeUnknownField === "keep-me"));

// ── DATA SAFETY: malformed file is NOT overwritten ──────────────────────────
console.log("— data safety: malformed file is not clobbered —");
await page.evaluate(async () => {
  await window.__app.vault.adapter.writeConfig("bookmarks.json", '"this is a json string, not an object"');
  await window.__geodeBookmarks.reload();
  await new Promise((r) => setTimeout(r, 120));
});
ok("malformed file → in-memory empty", (await list()).length === 0);
// attempt a write — persist must ABORT (re-read sees non-object → throw)
await page.evaluate(async () => { await window.__geodeBookmarks.toggleFile("Alpha.md"); await new Promise((r) => setTimeout(r, 150)); });
const rawMal = await page.evaluate(() => window.__app.vault.adapter.readConfig("bookmarks.json"));
ok("malformed file left intact (write aborted, no clobber)", rawMal === '"this is a json string, not an object"', rawMal?.slice(0, 60));

console.log(`\nR27 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
