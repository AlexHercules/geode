/**
 * R114 compat MetadataCache.getTags E2E — browser mode :1420.
 * Run: node .calibration/r114-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 114 additions" (compat 商业主轴).
 *
 * Obsidian `metadataCache.getTags(): Record<string, number>` — every tag (key carries the
 * leading '#') → how many notes use it. Backed by core getTagMap (tag→note-path Set, cached);
 * count = distinct notes (matches Obsidian's getAllTags-per-file aggregation). Geode indexes
 * tags case-sensitively, so #Tag / #tag are distinct keys.
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
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.app && !!window.app.metadataCache, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r114", name: "r114", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && typeof window.app.metadataCache.getTags === "function", null, { timeout: 5000 });

// seed notes: #alpha in two notes, #beta once, #Alpha (case), #gamma via frontmatter
await page.evaluate(async () => {
  await window.__app.vault.create("n1.md", "#alpha #beta\nbody\n");
  await window.__app.vault.create("n2.md", "more #alpha here\n");
  await window.__app.vault.create("n3.md", "#Alpha capitalized\n");
  await window.__app.vault.create("n4.md", "---\ntags:\n  - gamma\n---\n# n4\n");
  await window.__app.vault.create("n5.md", "no tags at all\n");
  await window.__app.vault.create("n7.md", "#parent/child nested\n");
  await window.__app.vault.create("n8.md", "#标签 cjk\n");
  await window.__app.vault.create("n9.md", "#__proto__ literal\n");
});
// wait until the index has parsed the tags
await page.waitForFunction(() => {
  const t = window.app.metadataCache.getTags();
  return t["#alpha"] === 2 && t["#beta"] === 1;
}, null, { timeout: 5000 });

const tags = await page.evaluate(() => window.app.metadataCache.getTags());

console.log("— getTags shape + counts —");
ok("returns a plain object (Record)", tags && typeof tags === "object" && !Array.isArray(tags));
ok("keys carry the leading '#'", Object.keys(tags).every((k) => k.startsWith("#")), JSON.stringify(Object.keys(tags)));
ok("#alpha counts 2 distinct notes (n1, n2)", tags["#alpha"] === 2, JSON.stringify(tags["#alpha"]));
ok("#beta counts 1", tags["#beta"] === 1, JSON.stringify(tags["#beta"]));
ok("case-sensitive: #Alpha is a SEPARATE key from #alpha (count 1)", tags["#Alpha"] === 1 && tags["#alpha"] === 2, JSON.stringify({ Alpha: tags["#Alpha"], alpha: tags["#alpha"] }));
ok("frontmatter tag #gamma is indexed (count 1)", tags["#gamma"] === 1, JSON.stringify(tags["#gamma"]));
ok("every value is a positive number", Object.values(tags).every((v) => typeof v === "number" && v > 0));
ok("untagged note contributes no key", !("#" in tags) && tags[""] === undefined);

console.log("— documented edges: nested / CJK / __proto__ —");
ok("nested tag → full path key '#parent/child' (no synthetic parent)", tags["#parent/child"] === 1 && tags["#parent"] === undefined, JSON.stringify({ child: tags["#parent/child"], parent: tags["#parent"] }));
ok("CJK tag → '#标签'", tags["#标签"] === 1, JSON.stringify(tags["#标签"]));
ok("literal '__proto__' tag is a safe OWN key '#__proto__' (no prototype pollution)", tags["#__proto__"] === 1 && Object.getPrototypeOf(tags) === Object.prototype, JSON.stringify(tags["#__proto__"]));

console.log("— live: a new tagged note bumps the count —");
const bumped = await page.evaluate(async () => {
  await window.__app.vault.create("n6.md", "#beta again\n");
  // poll a few index revisions
  for (let i = 0; i < 30; i++) {
    const t = window.app.metadataCache.getTags();
    if (t["#beta"] === 2) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
});
ok("creating a second #beta note → count becomes 2 (live, reflects index revision)", bumped);

console.log(`\nR114 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
