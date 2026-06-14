/**
 * R69 vault-wide tag rename E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r69-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 69 additions".
 *
 * Covers ㉝ renameTagAcrossVault via the always-on window.__geodeRenameTag probe
 * (real vault/metadata/documents engine) + the TagsPanel right-click → rename UI:
 *  - inline #old → #new (incl. nested #old/sub → #new/sub)
 *  - boundary: #old-ish / #x/old NOT touched (prefix, not substring)
 *  - frontmatter tags: array + scalar rewritten via builder (no hand-YAML)
 *  - code regions (inline + fenced) skipped (masked like the indexer)
 *  - CJK tags; no-op; descendant guard (a→a/b refused); open-file buffer path
 *  - UI: context menu + window.prompt rename + result banner
 *
 * Unique zz-prefixed + CJK tag families immune to the sample seed vault.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r69", name: "r69", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeRenameTag, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);
const read = (p) => app((path) => window.__app.vault.read(path), p);
const rename = (oldT, newT) => app(([o, n]) => window.__geodeRenameTag(o, n), [oldT, newT]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── seed ──────────────────────────────────────────────────────────────────
await create("tagz/a.md", "# A\n\nWork on #zzproj and #zzproj/api here.\n#zzproj/api/v2 deep, and #zzproj-old must stay.\n");
await create("tagz/b.md", "---\ntags: [zzproj, zzkeep]\n---\n# B\n\nbody #zzproj mention.\n");
await create("tagz/c.md", "---\ntags: zzproj\n---\n# C scalar tag\n");
await create("tagz/d.md", "# D\n\n`#zzproj` inline code stays.\n\n```\n#zzproj fenced stays\n```\n\nreal #zzproj here.\n");
await create("tagz/e.md", "# E\n\nCJK #项目 and #项目/子 nested.\n");
await create("tagz/open.md", "# Open\n\nbuffer #zzopen tag.\n");
await create("tagz/ui.md", "# UI\n\nmenu #zzui tag.\n");
// junk frontmatter item (whitespace) parseNote never indexes — must NOT be
// silently rewritten (rewrite-set ⊆ index-set; review Fix A).
await create("tagz/junk.md", "---\ntags: [\"zzjunk/bad space\", zzjunk]\n---\n# J\n\ninline #zzjunk here.\n");
await wait(400);

// ── 1. comprehensive inline + nested + frontmatter + code-skip rename ───────
console.log("— rename zzproj → zzwork (inline/nested/frontmatter/code) —");
const res = await rename("zzproj", "zzwork");
ok("changed 4 files (a,b,c,d)", res.filesChanged === 4, JSON.stringify(res));
ok("0 skipped", res.skipped.length === 0, JSON.stringify(res.skipped));
ok("tagsRewritten = 7 (a:3 + b:2 + c:1 + d:1)", res.tagsRewritten === 7, JSON.stringify(res));

const a = await read("tagz/a.md");
ok("a.md #zzproj → #zzwork", a.includes("#zzwork ") && !/#zzproj\b(?!-)/.test(a), a);
ok("a.md nested #zzproj/api → #zzwork/api", a.includes("#zzwork/api"), a);
ok("a.md deep #zzproj/api/v2 → #zzwork/api/v2", a.includes("#zzwork/api/v2"), a);
ok("a.md boundary #zzproj-old UNTOUCHED (prefix, not substring)", a.includes("#zzproj-old"), a);

const b = await read("tagz/b.md");
ok("b.md frontmatter tags: zzproj → zzwork", /zzwork/.test(b) && !/\bzzproj\b/.test(b), b);
ok("b.md frontmatter sibling zzkeep preserved", b.includes("zzkeep"), b);
ok("b.md body #zzproj → #zzwork", b.includes("body #zzwork mention"), b);

const c = await read("tagz/c.md");
ok("c.md scalar tags: zzproj → zzwork", /tags:\s*zzwork/.test(c) && !/\bzzproj\b/.test(c), c);

const d = await read("tagz/d.md");
ok("d.md inline-code `#zzproj` STAYS", d.includes("`#zzproj`"), d);
ok("d.md fenced #zzproj STAYS", d.includes("#zzproj fenced stays"), d);
ok("d.md real body #zzproj → #zzwork", d.includes("real #zzwork here"), d);

// ── 2. metadata reflects the rename (getTagMap) ─────────────────────────────
console.log("— index reflects rename —");
const tagMap = await app(() => Object.fromEntries([...window.__app.metadata.getTagMap()].map(([k, v]) => [k, v.size])));
ok("getTagMap no longer has zzproj", tagMap["zzproj"] === undefined, JSON.stringify(tagMap));
ok("getTagMap has zzwork", (tagMap["zzwork"] ?? 0) >= 1, JSON.stringify(tagMap));
ok("getTagMap keeps zzproj-old (boundary)", (tagMap["zzproj-old"] ?? 0) === 1, JSON.stringify(tagMap));

// ── 3. CJK rename ───────────────────────────────────────────────────────────
console.log("— CJK tag rename —");
const cjk = await rename("项目", "工作");
ok("CJK changed 1 file", cjk.filesChanged === 1, JSON.stringify(cjk));
const e = await read("tagz/e.md");
ok("e.md #项目 → #工作", e.includes("#工作 ") && !e.includes("#项目"), e);
ok("e.md nested #项目/子 → #工作/子", e.includes("#工作/子"), e);

// ── 4. no-op + descendant guard ─────────────────────────────────────────────
console.log("— no-op + descendant guard —");
const noop = await rename("zzkeep", "zzkeep");
ok("no-op (same tag) changes 0 files", noop.filesChanged === 0, JSON.stringify(noop));
const desc = await rename("zzwork", "zzwork/sub");
ok("descendant rename (a → a/b) refused → 0 files", desc.filesChanged === 0, JSON.stringify(desc));
const bad = await rename("zzwork", "bad name!");
ok("invalid target (space/metachar) refused → 0 files", bad.filesChanged === 0, JSON.stringify(bad));
const a2 = await read("tagz/a.md");
ok("a.md still #zzwork after refused renames", a2.includes("#zzwork"), a2);

// ── 4b. junk frontmatter item NOT silently rewritten (Fix A) ────────────────
console.log("— frontmatter junk item (whitespace) preserved —");
const jr = await rename("zzjunk", "zzfix");
ok("junk-file rename changes the file (inline + valid fm item)", jr.filesChanged === 1, JSON.stringify(jr));
const j = await read("tagz/junk.md");
ok("junk.md inline #zzjunk → #zzfix", j.includes("#zzfix"), j);
ok("junk.md valid fm 'zzjunk' → 'zzfix'", /\bzzfix\b/.test(j), j);
ok("junk.md whitespace item 'zzjunk/bad space' UNTOUCHED (not indexed)", j.includes("zzjunk/bad space"), j);

// ── 5. open-file buffer path ────────────────────────────────────────────────
console.log("— open-file buffer path —");
await app(async () => {
  window.__app.workspace.openFile("tagz/open.md");
  await new Promise((r) => setTimeout(r, 150));
});
const openRes = await rename("zzopen", "zzopened");
ok("open-file rename ≥1 changed", openRes.filesChanged >= 1, JSON.stringify(openRes));
const openBuf = await app(() => window.__app.documents.get("tagz/open.md")?.getText() ?? "");
ok("open buffer #zzopen → #zzopened (buffer path, not disk)", openBuf.includes("#zzopened") && !openBuf.includes("#zzopen "), openBuf);

// ── 6. TagsPanel right-click → rename UI ────────────────────────────────────
console.log("— TagsPanel context-menu rename UI —");
await app(() => window.__app.workspace.setRightPanel("tags"));
await page.waitForSelector("[data-testid=tags-panel]", { timeout: 4000 });
ok("tags panel renders", await page.isVisible("[data-testid=tags-panel]"));
await page.waitForSelector("[data-testid='tag-row-zzui']", { timeout: 4000 });
// right-click the zzui row → context menu
await page.click("[data-testid='tag-row-zzui']", { button: "right" });
await page.waitForSelector("[data-testid=tag-menu]", { timeout: 3000 });
ok("right-click opens tag-menu", await page.isVisible("[data-testid=tag-menu]"));
ok("menu has a rename item", await page.isVisible("[data-testid=tag-rename]"));
// accept the prompt with a new name, then click rename
page.once("dialog", (d) => d.accept("zzui-renamed"));
await page.click("[data-testid=tag-rename]");
await page.waitForSelector("[data-testid=tags-result]", { timeout: 4000 });
const resultText = await page.textContent("[data-testid=tags-result]");
ok("result banner shows after UI rename", typeof resultText === "string" && resultText.length > 0, resultText);
const ui = await read("tagz/ui.md");
ok("ui.md #zzui → #zzui-renamed via UI", ui.includes("#zzui-renamed") && !/#zzui\b(?!-)/.test(ui), ui);

// ── 7. invalid-name UI guard (no engine call) ───────────────────────────────
console.log("— UI invalid-name guard —");
await page.click("[data-testid='tag-row-zzui-renamed']", { button: "right" });
await page.waitForSelector("[data-testid=tag-menu]", { timeout: 3000 });
page.once("dialog", (d) => d.accept("has space"));
await page.click("[data-testid=tag-rename]");
await wait(150);
const invMsg = await page.textContent("[data-testid=tags-result]");
ok("invalid UI name shows renameInvalid (engine not called)", /[Ii]nvalid|不合法/.test(invMsg ?? ""), invMsg);

console.log(`\nR69 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
