/**
 * R26 byte-level render guard — the rebuilt r18-diff equivalent.
 * Renders a corpus of markdown sources through the EXACT reading-view pipeline
 * (window.__geodeRenderMarkdown, main.tsx) and snapshots the raw HTML strings.
 * Discipline (CLAUDE.md / data-safety §C): before changing core/markdown.ts,
 * capture a baseline; after, diff. Every NON-media case must stay byte-identical
 * (the Part-A invariant); only the new media-embed cases (media:true) may change.
 *
 * Usage (dev server :1420 up):
 *   node .calibration/r26-bytes.mjs --baseline   # write baseline.json (run BEFORE the change)
 *   node .calibration/r26-bytes.mjs              # diff vs baseline (run AFTER the change)
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BASE_URL = "http://localhost:1420";
const BASELINE = new URL("./r26-bytes.baseline.json", import.meta.url);
const writeBaseline = process.argv.includes("--baseline");

// corpus: { name, src, media? } — media:true cases are EXPECTED to change post-R26.
const CORPUS = [
  ["headings", "# H1\n## H2\n### H3 with **bold**"],
  ["emphasis", "**bold** _italic_ ~~strike~~ `code` text"],
  ["highlight", "==marked text== and normal"],
  ["list-ul", "- alpha\n- beta\n  - nested"],
  ["list-ol", "1. one\n2. two\n3. three"],
  ["list-task", "- [ ] todo\n- [x] done"],
  ["blockquote", "> quote line\n> second line"],
  ["callout", "> [!note] Title\n> callout body"],
  ["callout-fold", "> [!warning]- Collapsed\n> hidden body"],
  ["footnote", "text with a ref[^1]\n\n[^1]: the footnote"],
  ["comment", "before %%hidden comment%% after"],
  ["math-inline", "inline $x^2 + y^2$ done"],
  ["math-block", "$$\\int_0^1 x\\,dx$$"],
  ["code-fence", "```js\nconst a = 1;\nconsole.log(a);\n```"],
  ["code-inline", "use `npm run dev` here"],
  ["table", "| a | b |\n|---|---|\n| 1 | 2 |"],
  ["hr", "above\n\n---\n\nbelow"],
  ["md-link", "[label](https://example.com)"],
  ["wikilink", "see [[Note A]] here"],
  ["wikilink-sub", "see [[Note A#Heading]] here"],
  ["wikilink-alias", "see [[Note A|Alias]] here"],
  ["wikilink-unresolved", "see [[Ghost Note 9999]] here"],
  ["selflink", "jump to [[#Heading]]"],
  ["image-embed", "![[img.png]]"],
  ["image-embed-alias", "![[img.png|caption]]"],
  ["note-embed", "![[Note A]]"],
  ["note-embed-sub", "![[Note A#Heading]]"],
  ["mermaid", "```mermaid\ngraph TD; A-->B;\n```"],
  ["html-inline", "text <strong>raw</strong> end"],
  ["blockref", "a paragraph with a block id ^blk1"],
  ["mixed", "# Title\n\n![[img.png]] and [[Note A]] plus ==hi== and $x$.\n\n> [!tip] T\n> b"],
  // attachment that is NOT a media type → must STILL degrade to a link (invariant)
  ["embed-other-zip", "![[archive.zip]]"],
  // NEW media embeds — these MAY change post-R26
  ["embed-audio", "![[audio.mp3]]", true],
  ["embed-video", "![[video.mp4]]", true],
  ["embed-pdf", "![[doc.pdf]]", true],
  ["embed-pdf-page", "![[doc.pdf#page=2]]", true],
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.__geodeRenderMarkdown, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r26b", name: "r26b", onload(app) { window.__app = app; } }));

// fixtures so resolveLink / resolveAttachment succeed (content irrelevant — the
// byte probe only RENDERS placeholders, it does not hydrate/read binary).
await page.evaluate(async () => {
  const mk = async (p, c) => { try { await window.__app.vault.create(p, c); } catch { /* exists */ } };
  await mk("Note A.md", "# Heading\n\nNote A body.\n");
  await mk("img.png", "x");
  await mk("audio.mp3", "x");
  await mk("video.mp4", "x");
  await mk("doc.pdf", "x");
  await mk("archive.zip", "x");
  await new Promise((r) => setTimeout(r, 200));
});

const rendered = [];
for (const [name, src] of CORPUS) {
  const html = await page.evaluate((s) => window.__geodeRenderMarkdown(s, ""), src);
  rendered.push({ name, html });
}
await browser.close();

if (writeBaseline) {
  writeFileSync(BASELINE, JSON.stringify(rendered, null, 2) + "\n");
  console.log(`R26 bytes: wrote baseline (${rendered.length} cases) → ${BASELINE.pathname}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error("No baseline. Run with --baseline first (BEFORE changing markdown.ts).");
  process.exit(2);
}
const base = JSON.parse(readFileSync(BASELINE, "utf8"));
const baseByName = new Map(base.map((r) => [r.name, r.html]));
const mediaNames = new Set(CORPUS.filter((c) => c[2]).map((c) => c[0]));

let failed = 0, changedMedia = 0;
for (const { name, html } of rendered) {
  const prev = baseByName.get(name);
  if (prev === undefined) { console.log(`  ? ${name} (new case, no baseline)`); continue; }
  if (prev === html) {
    if (mediaNames.has(name)) console.log(`  · ${name} (media, unchanged — expected to change once R26 lands)`);
    continue;
  }
  if (mediaNames.has(name)) { changedMedia++; console.log(`  ✓ ${name} (media changed as expected)`); }
  else {
    failed++;
    console.log(`  ✗ BYTE DIFF in non-media case "${name}" — Part-A invariant violated`);
    console.log(`    was: ${prev}`);
    console.log(`    now: ${html}`);
  }
}
console.log(`\nR26 bytes: ${failed} invariant violation(s), ${changedMedia} media case(s) changed.`);
process.exit(failed ? 1 : 0);
