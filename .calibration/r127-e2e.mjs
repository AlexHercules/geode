/**
 * R127 compat CachedMetadata.footnotes + footnoteRefs E2E — browser mode :1420.
 * Run: node .calibration/r127-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 127 additions" (compat 商业主轴).
 *
 * Obsidian getFileCache(file): footnotes: FootnoteCache[] = `[^id]: content` DEFINITIONS;
 * footnoteRefs: FootnoteRefCache[] = inline `[^id]` REFERENCES in the body. Both {id (no caret),
 * position}. Geode bridges core parseNote: defs (R65) + refs (R127), both scanned on the MASKED
 * content so `[^id]` inside fenced/inline code + frontmatter is excluded. Footnote-aware plugins use these.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r127", name: "r127", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.metadataCache, null, { timeout: 5000 });

// refs in body (incl. a duplicate), 3 defs (incl. an orphan), and `[^id]` in frontmatter / fenced
// code / inline code that must ALL be excluded (masked). line map (0-based) used in assertions below.
const C = [
  "---",                                  // 0
  'fmref: "see [^z] here"',               // 1  ^z = frontmatter, excluded
  "---",                                  // 2
  "# Notes",                              // 3
  "",                                     // 4
  "Body ref [^1] and another [^note].",   // 5  refs ^1, ^note
  "",                                     // 6
  "A second [^1] reference.",             // 7  ref ^1 (duplicate)
  "",                                     // 8
  "```",                                  // 9
  "- code [^x] here",                     // 10 ^x = fenced code, excluded
  "```",                                  // 11
  "",                                     // 12
  "Inline `[^y]` code.",                  // 13 ^y = inline code, excluded
  "",                                     // 14
  "[^1]: first definition",               // 15 def ^1
  "[^note]: named definition",            // 16 def ^note
  "[^orphan]: orphan def with no ref",    // 17 def ^orphan
  "",                                     // 18
].join("\n");

const app = (fn, arg) => page.evaluate(fn, arg);
await app(async (c) => { try { await window.__app.vault.create("fn.md", c); } catch { /* exists */ } await window.__app.vault.read("fn.md"); }, C);
await page.waitForFunction(() => {
  const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("fn.md"));
  return m && Array.isArray(m.footnotes) && m.footnotes.length === 3 && Array.isArray(m.footnoteRefs) && m.footnoteRefs.length === 3;
}, null, { timeout: 5000 });

const cache = await app(() => window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("fn.md")));
const defs = cache.footnotes, refs = cache.footnoteRefs;

console.log("— footnote DEFINITIONS ([^id]: content) —");
ok("3 definitions", defs.length === 3, JSON.stringify(defs.length));
ok("def ids = [1, note, orphan] (no caret, document order, orphan kept)", eq(defs.map((d) => d.id), ["1", "note", "orphan"]), JSON.stringify(defs.map((d) => d.id)));
ok("def lines = [15, 16, 17]", eq(defs.map((d) => d.position.start.line), [15, 16, 17]), JSON.stringify(defs.map((d) => d.position.start.line)));

console.log("— inline REFERENCES ([^id] in body) —");
ok("3 references", refs.length === 3, JSON.stringify(refs.length));
ok("ref ids = [1, note, 1] (duplicate kept, document order)", eq(refs.map((r) => r.id), ["1", "note", "1"]), JSON.stringify(refs.map((r) => r.id)));
ok("ref lines = [5, 5, 7]", eq(refs.map((r) => r.position.start.line), [5, 5, 7]), JSON.stringify(refs.map((r) => r.position.start.line)));
ok("ref position spans the `[^id]` marker ([^1]=4, [^note]=7, [^1]=4)",
  eq(refs.map((r) => r.position.end.offset - r.position.start.offset), [4, 7, 4]),
  JSON.stringify(refs.map((r) => r.position.end.offset - r.position.start.offset)));

console.log("— masking: code / inline-code / frontmatter [^id] are NOT captured —");
const allIds = [...defs.map((d) => d.id), ...refs.map((r) => r.id)];
ok("no ^x (fenced code) anywhere", !allIds.includes("x"));
ok("no ^y (inline code) anywhere", !allIds.includes("y"));
ok("no ^z (frontmatter) anywhere", !allIds.includes("z"));
ok("a definition's own marker is NOT also counted as a reference (only 3 refs, not 6)", refs.length === 3);

console.log("— a MID-LINE `[^id]:` is a genuine reference, only a COL-0 `[^id]:` is a definition (review F1) —");
const midColon = await app(async () => {
  await window.__app.vault.create("midcolon.md", "text word[^9]: midline colon here.\n\n[^9]: real definition\n");
  await window.__app.vault.read("midcolon.md");
  for (let i = 0; i < 30; i++) {
    const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("midcolon.md"));
    if (m?.footnotes && m?.footnoteRefs) return { defs: m.footnotes.map((d) => [d.id, d.position.start.line]), refs: m.footnoteRefs.map((r) => [r.id, r.position.start.line]) };
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
});
ok("mid-line 'word[^9]: ...' → footnoteRef [9 @ line 0] (NOT dropped by a colon)", eq(midColon?.refs, [["9", 0]]), JSON.stringify(midColon?.refs));
ok("col-0 '[^9]: real definition' → footnote definition [9 @ line 2] only", eq(midColon?.defs, [["9", 2]]), JSON.stringify(midColon?.defs));

console.log("— a note with no footnotes → both fields absent —");
const none = await app(async () => {
  await window.__app.vault.create("nofn.md", "# Plain\n\nNo footnotes here.\n");
  await window.__app.vault.read("nofn.md");
  await new Promise((r) => setTimeout(r, 200));
  const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("nofn.md"));
  return { f: m.footnotes, r: m.footnoteRefs };
});
ok("no-footnote note → footnotes undefined", none.f === undefined, JSON.stringify(none.f));
ok("no-footnote note → footnoteRefs undefined", none.r === undefined, JSON.stringify(none.r));

console.log(`\nR127 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
