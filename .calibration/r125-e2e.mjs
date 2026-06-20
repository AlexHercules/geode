/**
 * R125 compat CachedMetadata.listItems E2E — browser mode :1420.
 * Run: node .calibration/r125-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 125 additions" (compat 商业主轴).
 *
 * Obsidian getFileCache(file).listItems: ListItemCache[] = every list item ({position, parent,
 * task?, id?}). parent encoding: nested item → parent line number of its parent item; ROOT item →
 * NEGATIVE of the list's first item line. task = the `[ ]` char (' '=incomplete, else done).
 * Geode resolves parents with an indent stack (top-level approximation; loose lists keep the list
 * open, adjacent distinct lists separated by a blank merge — documented deviation).
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

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r125", name: "r125", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.metadataCache, null, { timeout: 5000 });

// line 0=#Notes, 1=blank, 2..8 = a nested list w/ tasks + ^id, 9=blank, 10=loose continuation
const C = [
  "# Notes", "",
  "- root one", "  - child a", "  - child b", "- root two",
  "- [ ] todo", "- [x] done", "- has id ^li1", "",
  "- loose after blank", "",
].join("\n");

const app = (fn, arg) => page.evaluate(fn, arg);
await app(async (c) => { try { await window.__app.vault.create("li.md", c); } catch { /* exists */ } await window.__app.vault.read("li.md"); }, C);
await page.waitForFunction(() => {
  const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("li.md"));
  return m && Array.isArray(m.listItems) && m.listItems.length === 8;
}, null, { timeout: 5000 });

const cache = await app(() => window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("li.md")));
const li = cache.listItems;

console.log("— every list item is captured (incl. nested + loose) —");
ok("8 list items (5 root + 2 nested children + 1 loose continuation)", li.length === 8, JSON.stringify(li.length));
ok("item lines are [2,3,4,5,6,7,8,10]", eq(li.map((x) => x.position.start.line), [2, 3, 4, 5, 6, 7, 8, 10]), JSON.stringify(li.map((x) => x.position.start.line)));

console.log("— parent encoding (nested → parent line, root → -firstItemLine) —");
ok("parents = [-2,2,2,-2,-2,-2,-2,-2]", eq(li.map((x) => x.parent), [-2, 2, 2, -2, -2, -2, -2, -2]), JSON.stringify(li.map((x) => x.parent)));
ok("the two children point at 'root one' (line 2)", li[1].parent === 2 && li[2].parent === 2);
ok("root items carry the negative first-item line (-2)", li[0].parent === -2 && li[3].parent === -2);
ok("a loose item after a blank line stays in the list (parent -2)", li[7].parent === -2 && li[7].position.start.line === 10);

console.log("— task items —");
ok("'- [ ] todo' → task === ' ' (incomplete)", li[4].task === " ", JSON.stringify(li[4].task));
ok("'- [x] done' → task === 'x' (done)", li[5].task === "x", JSON.stringify(li[5].task));
ok("a non-task item has no task field", li[0].task === undefined && !("task" in li[0]));

console.log("— block id on a list item —");
ok("the item ending with ^li1 carries id 'li1'", li[6].id === "li1", JSON.stringify(li[6].id));

console.log("— ordered list + no-list note —");
const ordered = await app(async () => {
  await window.__app.vault.create("ord.md", "1. first\n2. second\n   1. nested\n");
  await window.__app.vault.read("ord.md");
  for (let i = 0; i < 30; i++) {
    const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("ord.md"));
    if (m?.listItems) return m.listItems.map((x) => x.parent);
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
});
ok("ordered list parents = [-0, -0, 1] (roots → -0, nested → parent line 1)", eq(ordered, [-0, -0, 1].map((n) => n === -0 ? 0 : n)), JSON.stringify(ordered));
const noList = await app(async () => {
  await window.__app.vault.create("nolist.md", "# just text\n\na paragraph\n");
  await window.__app.vault.read("nolist.md");
  await new Promise((r) => setTimeout(r, 200));
  return window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("nolist.md")).listItems;
});
ok("a note with no list items → listItems is absent (undefined)", noList === undefined, JSON.stringify(noList));

console.log("— a `- x` inside a fenced code block is NOT a list item (R125 review (a)) —");
const fenced = await app(async () => {
  await window.__app.vault.create("fence.md", "# h\n\n```\n- not a bullet\n- [ ] not a task\n```\n\n- real one\n");
  await window.__app.vault.read("fence.md");
  for (let i = 0; i < 30; i++) {
    const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("fence.md"));
    if (m?.listItems) return m.listItems.map((x) => ({ line: x.position.start.line, task: x.task }));
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
});
ok("only the real item (line 7) survives — no phantom items from the fence", eq(fenced, [{ line: 7, task: undefined }]), JSON.stringify(fenced));

console.log("— `^id` attaches to its own line, NOT the last sibling of the block run (R125 review (b)) —");
const idAttach = await app(async () => {
  await window.__app.vault.create("idattach.md", "- a ^x\n- b\n- c\n");
  await window.__app.vault.read("idattach.md");
  for (let i = 0; i < 30; i++) {
    const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("idattach.md"));
    if (m?.listItems) return m.listItems.map((x) => x.id ?? null);
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
});
ok("contiguous '- a ^x / - b / - c' → id 'x' on item a only, c has none", eq(idAttach, ["x", null, null]), JSON.stringify(idAttach));

console.log("— a column-0 fenced code block BREAKS the list like a paragraph (re-review (c)) —");
const split = await app(async () => {
  await window.__app.vault.create("split.md", "- a\n```\nx\n```\n- b\n");
  await window.__app.vault.read("split.md");
  for (let i = 0; i < 30; i++) {
    const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("split.md"));
    if (m?.listItems) return m.listItems.map((x) => ({ line: x.position.start.line, parent: x.parent }));
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
});
ok("'- a' / fence / '- b' → TWO lists, b is its own root (parent -4, not merged into a)", eq(split, [{ line: 0, parent: 0 }, { line: 4, parent: -4 }]), JSON.stringify(split));

console.log("— a YAML list entry inside frontmatter is NOT a document list item (re-review (d)) —");
const fm = await app(async () => {
  await window.__app.vault.create("fmlist.md", "---\ntags:\n  - aa ^x\n---\n\n- real\n");
  await window.__app.vault.read("fmlist.md");
  for (let i = 0; i < 30; i++) {
    const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("fmlist.md"));
    if (m?.listItems) return m.listItems.map((x) => ({ line: x.position.start.line, id: x.id ?? null }));
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
});
ok("only the body '- real' (line 5) is captured — frontmatter '- aa ^x' excluded, no phantom id", eq(fm, [{ line: 5, id: null }]), JSON.stringify(fm));

console.log(`\nR125 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
