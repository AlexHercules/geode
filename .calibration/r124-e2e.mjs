/**
 * R124 compat CachedMetadata.sections E2E — browser mode :1420.
 * Run: node .calibration/r124-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 124 additions" (compat 商业主轴).
 *
 * Obsidian getFileCache(file).sections: SectionCache[] = top-level block segmentation
 * ({type, position, id?}). Geode classifies each block by its first line (non-exhaustive per
 * Obsidian); frontmatter→yaml, fenced code is ATOMIC (internal blank lines don't split it),
 * else blank-line blocks classified heading/list/blockquote/thematicBreak/table/html/paragraph.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r124", name: "r124", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.metadataCache, null, { timeout: 5000 });

// a doc with every top-level block type; the fenced code has an internal blank line (must NOT split)
const C = [
  "---", "title: Test", "---",
  "# Heading One", "",
  "A paragraph of text.", "",
  "```js", "const x = 1;", "", "const y = 2;", "```", "",
  "- list item a", "- list item b", "",
  "> a blockquote line", "",
  "---", "",
  "| a | b |", "| --- | --- |", "| 1 | 2 |", "",
  "A block with an id. ^myblock", "",
].join("\n");

const app = (fn, arg) => page.evaluate(fn, arg);
await app(async (c) => { try { await window.__app.vault.create("sec.md", c); } catch { /* exists */ } await window.__app.vault.read("sec.md"); }, C);
await page.waitForFunction(() => {
  const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("sec.md"));
  return m && Array.isArray(m.sections) && m.sections.length >= 8;
}, null, { timeout: 5000 });

const cache = await app(() => window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("sec.md")));
const types = cache.sections.map((s) => s.type);

console.log("— top-level block types in order —");
ok("section types match the expected sequence", eq(types, ["yaml", "heading", "paragraph", "code", "list", "blockquote", "thematicBreak", "table", "paragraph"]), JSON.stringify(types));

console.log("— fenced code is ONE atomic block (internal blank line not split) —");
const code = cache.sections.find((s) => s.type === "code");
ok("there is exactly one code section", cache.sections.filter((s) => s.type === "code").length === 1);
ok("the code section spans the whole fence (covers 'const y' after the blank line)", !!code && C.slice(code.position.start.offset, code.position.end.offset).includes("const y = 2;"), JSON.stringify(code?.position));
ok("the code section starts at the ``` opener", !!code && C.slice(code.position.start.offset, code.position.start.offset + 3) === "```");

console.log("— positions are byte-accurate (each section's slice starts as expected) —");
ok("yaml section starts at offset 0", cache.sections[0].position.start.offset === 0 && cache.sections[0].type === "yaml");
ok("heading section text begins with '# Heading'", C.slice(cache.sections[1].position.start.offset).startsWith("# Heading One"));
ok("every section's start offset is strictly increasing", cache.sections.every((s, i) => i === 0 || s.position.start.offset > cache.sections[i - 1].position.start.offset));

console.log("— block id attaches to its section —");
const withId = cache.sections.find((s) => s.id);
ok("the paragraph ending with ^myblock carries id 'myblock'", withId?.id === "myblock" && withId?.type === "paragraph", JSON.stringify({ id: withId?.id, type: withId?.type }));

console.log("— a plain note: paragraphs only, no frontmatter —");
const plain = await app(async () => {
  await window.__app.vault.create("plain.md", "first para line\nstill first\n\nsecond para\n");
  await window.__app.vault.read("plain.md");
  for (let i = 0; i < 30; i++) {
    const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("plain.md"));
    if (m?.sections) return m.sections.map((s) => s.type);
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
});
ok("two blank-line-separated paragraphs → ['paragraph','paragraph'], no yaml", eq(plain, ["paragraph", "paragraph"]), JSON.stringify(plain));

console.log("— D1 fix: a heading NOT blank-separated still breaks the block —");
const d1 = await app(async () => {
  await window.__app.vault.create("d1.md", "# H\nbody no blank\n\nsecond\n# H2\nafter h2\n");
  await window.__app.vault.read("d1.md");
  for (let i = 0; i < 30; i++) {
    const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("d1.md"));
    if (m?.sections) return m.sections.map((s) => s.type);
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
});
ok("'# H\\nbody...\\n# H2\\nafter' → heading/paragraph break even with no blank line", eq(d1, ["heading", "paragraph", "paragraph", "heading", "paragraph"]), JSON.stringify(d1));

console.log(`\nR124 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
