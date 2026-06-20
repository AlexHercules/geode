/**
 * R126 compat CachedMetadata.frontmatterLinks E2E — browser mode :1420.
 * Run: node .calibration/r126-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 126 additions" (compat 商业主轴).
 *
 * Obsidian getFileCache(file).frontmatterLinks: FrontmatterLinkCache[] = every `[[wikilink]]` inside
 * a frontmatter property value ({key, link, original, displayText?}). key = field name, or `field.N`
 * for the Nth element of a list property. NO position (Obsidian identifies it by key). Geode mirrors
 * core WIKILINK_RE: link = target without `#subpath` (matches body LinkCache.link), displayText = the
 * `|alias`. Used by Dataview / graph / link-aware plugins reading `related: "[[Note]]"` properties.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r126", name: "r126", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.metadataCache, null, { timeout: 5000 });

// frontmatter with: bare link, aliased link, subpath link, two links in one value, inline-array
// list, block-list, and a plain (no-link) value. Body has NO links (frontmatterLinks must be FM-only).
const C = [
  "---",
  'related: "[[Note A]]"',
  'link: "[[Target|Display]]"',
  'ref: "[[Note#Heading]]"',
  'note: "see [[A]] and [[B]]"',
  'refs: ["[[R1]]", "[[R2]]"]',
  "sources:",
  '  - "[[X]]"',
  '  - "[[Y]]"',
  "plain: just text",
  "---",
  "# Body",
  "",
  "A body [[BodyLink]] must NOT appear in frontmatterLinks.",
  "",
].join("\n");

const app = (fn, arg) => page.evaluate(fn, arg);
await app(async (c) => { try { await window.__app.vault.create("fml.md", c); } catch { /* exists */ } await window.__app.vault.read("fml.md"); }, C);
await page.waitForFunction(() => {
  const m = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("fml.md"));
  return m && Array.isArray(m.frontmatterLinks) && m.frontmatterLinks.length === 9;
}, null, { timeout: 5000 });

const cache = await app(() => window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("fml.md")));
const fl = cache.frontmatterLinks;

console.log("— every frontmatter wikilink is captured (9: 1+1+1+2+2+2) —");
ok("9 frontmatterLinks (string/alias/subpath/2-in-one/inline-array/block-list)", fl.length === 9, JSON.stringify(fl.length));
ok("body [[BodyLink]] is NOT in frontmatterLinks (FM-only)", !fl.some((x) => x.link === "BodyLink"));

console.log("— key encoding (field name, or field.N for list elements) —");
ok("keys = [related, link, ref, note, note, refs.0, refs.1, sources.0, sources.1]",
  eq(fl.map((x) => x.key), ["related", "link", "ref", "note", "note", "refs.0", "refs.1", "sources.0", "sources.1"]),
  JSON.stringify(fl.map((x) => x.key)));

console.log("— link targets (subpath dropped, mirrors body LinkCache.link) —");
ok("links = [Note A, Target, Note, A, B, R1, R2, X, Y]",
  eq(fl.map((x) => x.link), ["Note A", "Target", "Note", "A", "B", "R1", "R2", "X", "Y"]),
  JSON.stringify(fl.map((x) => x.link)));
ok("'[[Note#Heading]]' → link 'Note' (subpath excluded, like core WIKILINK_RE)", fl[2].link === "Note");

console.log("— original (the written [[..]]) + displayText (alias only) —");
ok("originals are the raw [[..]] texts", eq(fl.map((x) => x.original),
  ["[[Note A]]", "[[Target|Display]]", "[[Note#Heading]]", "[[A]]", "[[B]]", "[[R1]]", "[[R2]]", "[[X]]", "[[Y]]"]),
  JSON.stringify(fl.map((x) => x.original)));
ok("only the aliased link carries displayText === 'Display'", fl[1].displayText === "Display");
ok("a non-aliased link has no displayText field", fl[0].displayText === undefined && !("displayText" in fl[0]));

console.log("— two links in ONE value share that value's key —");
ok("'see [[A]] and [[B]]' → two links, both key 'note'", fl[3].key === "note" && fl[4].key === "note" && fl[3].link === "A" && fl[4].link === "B");

console.log("— a note with frontmatter but no wikilinks → frontmatterLinks absent —");
const noLinks = await app(async () => {
  await window.__app.vault.create("nofl.md", "---\ntitle: Plain\ntags: [a, b]\n---\n\nbody\n");
  await window.__app.vault.read("nofl.md");
  await new Promise((r) => setTimeout(r, 200));
  return window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("nofl.md")).frontmatterLinks;
});
ok("plain frontmatter (no [[..]]) → frontmatterLinks is undefined", noLinks === undefined, JSON.stringify(noLinks));

console.log("— a note with NO frontmatter → frontmatterLinks absent —");
const noFm = await app(async () => {
  await window.__app.vault.create("nofm2.md", "# Just a heading\n\n[[Body]] only.\n");
  await window.__app.vault.read("nofm2.md");
  await new Promise((r) => setTimeout(r, 200));
  return window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("nofm2.md")).frontmatterLinks;
});
ok("no frontmatter → frontmatterLinks is undefined", noFm === undefined, JSON.stringify(noFm));

console.log(`\nR126 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
