/**
 * R28 explorer drag-to-move E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r28-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 28 additions".
 *
 * Drives the SAME decision core the Explorer drop handler uses, via the
 * always-on probe window.__geodeExplorerMove(fromPath, hoveredPath) — the four
 * guards (no-op / self-descendant / collision / stale) + the R16 write throat
 * renameWithLinkUpdate. Plus DOM checks: rows are draggable; dragover paints a
 * drop-target highlight on the hovered folder.
 *
 * Covers: move file into folder (row relocates) + link resolution preserved;
 * no-op reject (drop on own parent); self & descendant reject; DATA SAFETY:
 * name collision rejected, destination file NOT overwritten; folder move carries
 * descendants; drop to vault root; draggable attr + is-drop-target highlight.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r28", name: "r28", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeExplorerMove, null, { timeout: 5000 });

const create = (p, c = "") => page.evaluate(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
const mkdir = (p) => page.evaluate(async (path) => {
  try { await window.__app.vault.createFolder(path); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, p);
const move = (from, hovered) => page.evaluate(async ([f, h]) => {
  const r = await window.__geodeExplorerMove(f, h);
  await new Promise((res) => setTimeout(res, 80));
  return r;
}, [from, hovered]);
const fileExists = (p) => page.evaluate((path) => window.__app.vault.fileExists(path), p);
const folderExists = (p) => page.evaluate((path) => window.__app.vault.folderExists(path), p);
const readFile = (p) => page.evaluate((path) => window.__app.vault.read(path), p);
const resolveLink = (tg, from) => page.evaluate(([t, f]) => window.__app.metadata.resolveLink(t, f), [tg, from]);

// ── move file into folder ───────────────────────────────────────────────────
console.log("— move file into folder —");
await mkdir("Notes");
await create("Notes/keep.md", "# keep\n");
await create("loose.md", "# loose\n");
await create("ref.md", "see [[loose]]\n");
const r1 = await move("loose.md", "Notes");
ok("move file → folder reports moved", r1.moved === true && r1.target === "Notes/loose.md", JSON.stringify(r1));
ok("file now at new path", await fileExists("Notes/loose.md"));
ok("file gone from old path", !(await fileExists("loose.md")));
ok("referrer link still resolves after move", (await resolveLink("loose", "ref.md")) === "Notes/loose.md");

// ── no-op reject (drop on own parent folder / sibling) ──────────────────────
console.log("— no-op reject —");
const r2 = await move("Notes/keep.md", "Notes"); // already inside Notes
ok("drop on own parent folder = no-op (invalid)", r2.moved === false && r2.reason === "invalid", JSON.stringify(r2));
ok("no-op left file in place", await fileExists("Notes/keep.md"));
const r2b = await move("Notes/keep.md", "Notes/loose.md"); // hover a sibling file → parent Notes
ok("drop on sibling file = no-op (invalid)", r2b.moved === false && r2b.reason === "invalid", JSON.stringify(r2b));

// ── self & descendant reject ────────────────────────────────────────────────
console.log("— self & descendant reject —");
await mkdir("Parent");
await mkdir("Parent/Child");
const r3a = await move("Parent", "Parent"); // onto itself
ok("folder onto itself rejected", r3a.moved === false && r3a.reason === "invalid", JSON.stringify(r3a));
const r3b = await move("Parent", "Parent/Child"); // into own descendant
ok("folder into own descendant rejected", r3b.moved === false && r3b.reason === "invalid", JSON.stringify(r3b));
ok("Parent untouched after illegal drops", await folderExists("Parent") && await folderExists("Parent/Child"));

// ── DATA SAFETY: name collision rejected, destination NOT overwritten ────────
console.log("— data safety: collision not overwritten —");
await mkdir("Dest");
await create("Dest/dup.md", "DEST ORIGINAL CONTENT\n");
await create("dup.md", "ROOT CONTENT\n");
const r4 = await move("dup.md", "Dest");
ok("collision reported, no move", r4.moved === false && r4.reason === "collision", JSON.stringify(r4));
ok("source file still at root (not moved/lost)", await fileExists("dup.md"));
ok("destination file NOT overwritten", (await readFile("Dest/dup.md")) === "DEST ORIGINAL CONTENT\n");

// ── folder move carries descendants ─────────────────────────────────────────
console.log("— folder move carries descendants —");
await mkdir("Box");
await create("Box/inner.md", "# inner\n");
await mkdir("Crate");
const r5 = await move("Box", "Crate");
ok("folder move reported", r5.moved === true && r5.target === "Crate/Box", JSON.stringify(r5));
ok("moved folder exists at new path", await folderExists("Crate/Box"));
ok("descendant file carried along", await fileExists("Crate/Box/inner.md"));
ok("old folder path gone", !(await folderExists("Box")));

// ── drop to vault root ──────────────────────────────────────────────────────
console.log("— drop to vault root —");
await mkdir("Sub");
await create("Sub/up.md", "# up\n");
const r6 = await move("Sub/up.md", null); // null hovered = empty space = root
ok("drop to root reported", r6.moved === true && r6.target === "up.md", JSON.stringify(r6));
ok("file now at root", await fileExists("up.md"));
ok("file gone from sub", !(await fileExists("Sub/up.md")));
const r6b = await move("up.md", null); // already at root → no-op
ok("root file dropped on root = no-op", r6b.moved === false && r6b.reason === "invalid", JSON.stringify(r6b));

// ── DOM: rows draggable + drop-target highlight on dragover ─────────────────
console.log("— DOM: draggable + highlight —");
await page.evaluate(() => window.__app.workspace.setLeftPanel?.("explorer"));
await page.waitForSelector("[data-testid=explorer-item]", { timeout: 4000 }).catch(() => {});
const anyDraggable = await page.evaluate(
  () => [...document.querySelectorAll('[data-testid="explorer-item"]')].every((el) => el.getAttribute("draggable") === "true"),
);
ok("all explorer rows are draggable", anyDraggable);
// synthetic dragover: a shared DataTransfer carrying the explorer MIME, hover a folder row
const highlighted = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('[data-testid="explorer-item"]')];
  const folderRow = rows.find((el) => el.getAttribute("data-path") === "Notes");
  const fileRow = rows.find((el) => el.getAttribute("data-path") === "ref.md");
  if (!folderRow || !fileRow) return "rows-missing";
  const dt = new DataTransfer();
  dt.setData("application/x-geode-path", "ref.md");
  fileRow.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
  await new Promise((r) => setTimeout(r, 10)); // let the deferred setDraggingPath land
  folderRow.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: dt }));
  await new Promise((r) => setTimeout(r, 20));
  const has = folderRow.classList.contains("is-drop-target");
  fileRow.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
  return has ? "ok" : "no-highlight";
});
ok("dragover paints is-drop-target on hovered folder", highlighted === "ok", highlighted);

console.log(`\nR28 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
