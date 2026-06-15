/**
 * R72 new-link format E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r72-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 72 additions" (㉞-c).
 *
 * Drives formatLink via the always-on window.__geodeFormatLink probe (sets the
 * link-format settings then builds the link), covering wikilink/markdown ×
 * shortest/relative/absolute × embed × alias, the two degradation guards, md
 * href encoding, and a round-trip (the produced link resolves back to target via
 * __geodeRenderMarkdown → internal-link).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r72", name: "r72", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeFormatLink && !!window.__geodeRenderMarkdown && !!window.__geodeUnlinked && !!window.__geodeComposer && !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
const fmt = (target, from, opts) => app(([t, f, o]) => window.__geodeFormatLink(t, f, o), [target, from, opts]);
const render = (src, from = "") => app(([s, f]) => window.__geodeRenderMarkdown(s, f), [src, from]);
const readFile = (p) => app(([path]) => window.__app.vault.read(path), [p]);
const linkAll = (active, source) => app(([a, s]) => window.__geodeUnlinked.linkAll(a, s), [active, source]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await create("Note.md", "# Note\n");
await create("folder/Sub.md", "# Sub\n");
await create("a/from.md", "x\n");
await create("b/Target.md", "# Target\n");
await create("my note.md", "# Spaced\n");
await create("img.png", "x");
await wait(400);

// ── wikilink forms ──────────────────────────────────────────────────────────
console.log("— wikilink forms —");
ok("wiki + shortest (unique) → [[Note]]", await fmt("Note.md", "x.md", { useMarkdown: false, pathFormat: "shortest" }) === "[[Note]]");
ok("wiki + absolute → [[folder/Sub]]", await fmt("folder/Sub.md", "x.md", { useMarkdown: false, pathFormat: "absolute" }) === "[[folder/Sub]]");
ok("wiki + alias → [[folder/Sub|My Sub]]", await fmt("folder/Sub.md", "x.md", { useMarkdown: false, pathFormat: "absolute", alias: "My Sub" }) === "[[folder/Sub|My Sub]]");

// ── markdown forms ──────────────────────────────────────────────────────────
console.log("— markdown forms —");
ok("md + shortest → [Note](Note.md)", await fmt("Note.md", "x.md", { useMarkdown: true, pathFormat: "shortest" }) === "[Note](Note.md)");
ok("md + absolute → [Sub](folder/Sub.md)", await fmt("folder/Sub.md", "x.md", { useMarkdown: true, pathFormat: "absolute" }) === "[Sub](folder/Sub.md)");
ok("md + relative → [Target](../b/Target.md)", await fmt("b/Target.md", "a/from.md", { useMarkdown: true, pathFormat: "relative" }) === "[Target](../b/Target.md)");
ok("md + alias → [My Note](Note.md)", await fmt("Note.md", "x.md", { useMarkdown: true, pathFormat: "shortest", alias: "My Note" }) === "[My Note](Note.md)");
ok("md href encodes spaces → [my note](my%20note.md)", await fmt("my note.md", "x.md", { useMarkdown: true, pathFormat: "shortest" }) === "[my note](my%20note.md)");

// ── degradation guards ──────────────────────────────────────────────────────
console.log("— degradation guards —");
ok("guard (a): wiki + relative → shortest [[Target]] (NOT ../)", await fmt("b/Target.md", "a/from.md", { useMarkdown: false, pathFormat: "relative" }) === "[[Target]]");
ok("guard (b): embed + markdown setting → ![[img.png]] (wikilink embed)", await fmt("img.png", "x.md", { useMarkdown: true, pathFormat: "absolute", embed: true }) === "![[img.png]]");
ok("guard (b): md NOTE embed → ![[Note]] (wikilink embed)", await fmt("Note.md", "x.md", { useMarkdown: true, pathFormat: "shortest", embed: true }) === "![[Note]]");
ok("attachment link (non-embed, md setting) → still wikilink embed when embed:true", await fmt("img.png", "x.md", { useMarkdown: false, embed: true }) === "![[img.png]]");

// ── round-trip: produced links resolve back to target ───────────────────────
console.log("— round-trip resolve-back —");
const mdShort = await fmt("Note.md", "x.md", { useMarkdown: true, pathFormat: "shortest" }); // [Note](Note.md)
const mdRendered = await render(mdShort, "x.md");
ok("md link renders as internal-link (resolves back)", /class="internal-link"/.test(mdRendered) && /data-target="Note\.md"/.test(mdRendered), mdRendered);
const mdRel = await fmt("b/Target.md", "a/from.md", { useMarkdown: true, pathFormat: "relative" }); // [Target](../b/Target.md)
const relRendered = await render(mdRel, "a/from.md");
ok("relative md link resolves back to b/Target.md", /data-target="b\/Target\.md"/.test(relRendered), relRendered);

// ── unlinked-mention "Link all" honors the markdown setting (real write path) ─
console.log("— unlinked mention → markdown link —");
await create("mref.md", "I mention Note here\n");
await fmt("Note.md", "x.md", { useMarkdown: true, pathFormat: "shortest" }); // flip global setting ON
await linkAll("Note.md", "mref.md");
await wait(150);
const mrefMd = await readFile("mref.md");
ok("markdown mode: mention rewritten to [Note](Note.md)", mrefMd.includes("[Note](Note.md)") && !mrefMd.includes("[[Note]]"), mrefMd);

// regression (review root cause #1): a spaced active-note name → percent-encoded
// href; the post-rewrite verification MUST resolveByKind (resolveLink can't
// decode %20 → would silently skip the VALID link). resolveLink-only would
// leave smref.md unchanged here.
await create("Spaced Note.md", "# Spaced Note\n");
await create("smref.md", "I mention Spaced Note here\n");
await fmt("Spaced Note.md", "x.md", { useMarkdown: true, pathFormat: "shortest" });
await linkAll("Spaced Note.md", "smref.md");
await wait(150);
const smrefMd = await readFile("smref.md");
ok("markdown mode: spaced-name mention → [Spaced Note](Spaced%20Note.md)", smrefMd.includes("[Spaced Note](Spaced%20Note.md)"), smrefMd);

// regression (review root cause #1): cross-folder relative md href with an
// ambiguous basename — resolveLink basename-fuzzes to the WRONG same-folder file
// (p/Dup) and skips; resolveByKind exact-resolves the position-bearing href.
await create("p/Dup.md", "# P Dup\n");
await create("q/Dup.md", "# Q Dup\n");
await create("p/dsrc.md", "I mention Dup here\n");
await fmt("q/Dup.md", "x.md", { useMarkdown: true, pathFormat: "relative" });
await linkAll("q/Dup.md", "p/dsrc.md");
await wait(150);
const dsrcMd = await readFile("p/dsrc.md");
ok("markdown+relative: ambiguous-basename mention → [Dup](../q/Dup.md)", dsrcMd.includes("[Dup](../q/Dup.md)"), dsrcMd);

await create("wref.md", "I mention Note here\n");
await fmt("Note.md", "x.md", { useMarkdown: false, pathFormat: "shortest" }); // flip global setting OFF
await linkAll("Note.md", "wref.md");
await wait(150);
const wrefMd = await readFile("wref.md");
ok("wikilink mode (default): mention rewritten to [[Note]]", wrefMd.includes("[[Note]]"), wrefMd);

// ── extract-to-note replacement honors the markdown setting (noteComposer) ───
console.log("— extract replacement —");
await fmt("Note.md", "x.md", { useMarkdown: true }); // global ON
ok("extract link (md mode) → [Extracted](Extracted.md)", await app(() => window.__geodeComposer.replacement("Extracted", "link")) === "[Extracted](Extracted.md)");
ok("extract embed (md mode) → ![[Extracted]] (embed always wikilink)", await app(() => window.__geodeComposer.replacement("Extracted", "embed")) === "![[Extracted]]");
await fmt("Note.md", "x.md", { useMarkdown: false }); // global OFF
ok("extract link (wiki mode) → [[Extracted]]", await app(() => window.__geodeComposer.replacement("Extracted", "link")) === "[[Extracted]]");

// ── markdown display ']' guard: no broken [a]b](..) link ever written ────────
console.log("— markdown ']' display guard —");
await create("a]b.md", "# Bracket\n");
ok("md: target basename with ']' → null (not broken [a]b](..))", await fmt("a]b.md", "x.md", { useMarkdown: true, pathFormat: "shortest" }) === null);
ok("md: alias with ']' → null", await fmt("Note.md", "x.md", { useMarkdown: true, pathFormat: "shortest", alias: "Bad]Name" }) === null);
ok("wiki: target basename with ']' → null (parity, unchanged)", await fmt("a]b.md", "x.md", { useMarkdown: false, pathFormat: "shortest" }) === null);

// ── default (wikilink + shortest) is unchanged — anchors r67/r44 ─────────────
console.log("— default unchanged —");
ok("default wiki+shortest still [[Note]]", await fmt("Note.md", "x.md", { useMarkdown: false, pathFormat: "shortest" }) === "[[Note]]");
ok("unresolvable/unsafe → null", await fmt("nope/ghost.md", "x.md", { useMarkdown: false, pathFormat: "absolute" }) === null);

console.log(`\nR72 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
