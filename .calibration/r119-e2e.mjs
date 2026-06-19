/**
 * R119 compat CachedMetadata.embeds E2E — browser mode :1420.
 * Run: node .calibration/r119-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 119 additions" (compat 商业主轴).
 *
 * Obsidian getFileCache(file).embeds: EmbedCache[] for `![[..]]` wikilink embeds, filed SEPARATELY
 * from .links (`[[..]]`). EmbedCache = {link, original, displayText?, position}. Geode core indexes
 * `![[..]]` as a wikilink (the `!` sits at l.from-1); R119 splits embeds out of links in buildCache.
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
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r119", name: "r119", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.metadataCache, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const MIX = "see [[target]] and embed ![[image.png]] and aliased ![[doc.pdf|My Doc]]\n";
await app(async (cs) => {
  try { await window.__app.vault.create("mix.md", cs[0]); } catch { /* exists */ }
  try { await window.__app.vault.create("onlylink.md", "just a [[plain]] link\n"); } catch { /* exists */ }
  try { await window.__app.vault.create("onlyembed.md", "only an ![[pic.png]] embed\n"); } catch { /* exists */ }
  // warm the content cache so buildCache sees the text (embeds need content to detect the `!`)
  for (const p of ["mix.md", "onlylink.md", "onlyembed.md"]) await window.__app.vault.read(p);
}, [MIX]);
// getFileCache(file) — poll until the content-backed cache (with embeds) is ready
await page.waitForFunction(() => {
  const c = window.app.metadataCache.getFileCache(window.app.vault.getFileByPath("mix.md"));
  return c && Array.isArray(c.embeds) && c.embeds.length === 2;
}, null, { timeout: 5000 });

const cache = (p) => app((path) => window.app.metadataCache.getFileCache(window.app.vault.getFileByPath(path)), p);

console.log("— embeds populated from ![[..]] —");
const mix = await cache("mix.md");
ok("embeds has the 2 ![[..]] references", mix.embeds?.length === 2, JSON.stringify(mix.embeds));
ok("embed link = 'image.png' with original '![[image.png]]'", mix.embeds.some((e) => e.link === "image.png" && e.original === "![[image.png]]"), JSON.stringify(mix.embeds));
ok("aliased embed has displayText 'My Doc' + original '![[doc.pdf|My Doc]]'", mix.embeds.some((e) => e.link === "doc.pdf" && e.displayText === "My Doc" && e.original === "![[doc.pdf|My Doc]]"), JSON.stringify(mix.embeds));
ok("every embed original starts with '![['", mix.embeds.every((e) => e.original.startsWith("![[")), JSON.stringify(mix.embeds.map((e) => e.original)));
ok("embed position spans the '!' (start offset = index of '!')", mix.embeds.some((e) => e.link === "image.png" && e.position?.start?.offset === MIX.indexOf("![[image.png]]")), JSON.stringify(mix.embeds.map((e) => e.position?.start?.offset)));

console.log("— links no longer contain the embeds (faithful split) —");
ok("links has the [[target]] wikilink", mix.links?.some((l) => l.link === "target"), JSON.stringify(mix.links));
ok("links does NOT contain the ![[..]] embeds", !mix.links?.some((l) => l.link === "image.png" || l.link === "doc.pdf"), JSON.stringify(mix.links));

console.log("— absent when there are no embeds / no links —");
const onlyLink = await cache("onlylink.md");
ok("note with only [[..]] → embeds is absent (undefined)", onlyLink.embeds === undefined, JSON.stringify(onlyLink.embeds));
ok("note with only [[..]] → links present", onlyLink.links?.some((l) => l.link === "plain"));
const onlyEmbed = await cache("onlyembed.md");
ok("note with only ![[..]] → embeds present, links absent", onlyEmbed.embeds?.length === 1 && onlyEmbed.links === undefined, JSON.stringify({ e: onlyEmbed.embeds, l: onlyEmbed.links }));

console.log(`\nR119 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
