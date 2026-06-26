/**
 * R70 markdown-link rename rewrite E2E — browser mode (Memory vault) against
 * dev :1420. Run: node .calibration/r70-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 70 additions".
 *
 * Covers ㉞-a: the R16 verified-rewrite engine, extended to rewrite standard
 * markdown links `[text](note.md)` on file/folder rename (was wikilink-only),
 * driven through the always-on window.__geodeRename probe:
 *  - basename / path-form / anchor / titled md links → new vault-relative href
 *  - %20-encoded paths; wikilink + md link coexist (both rewritten)
 *  - external (https/mailto) + same-file (#anchor) + code-region links untouched
 *  - md image embed ![](pic.png) IS rewritten on rename (R243: indexed, ! preserved)
 *  - relative ../ resolved; folder move rewrites path-form md links
 *
 * Unique mdl/ tree, immune to the sample seed vault.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r70", name: "r70", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeRename && !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
const read = (p) => app((path) => window.__app.vault.read(path), p);
const rename = (oldP, newP) => app(([o, n]) => window.__geodeRename(o, n), [oldP, newP]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── seed ────────────────────────────────────────────────────────────────────
await create("mdl/target.md", "# Target\n");
await create(
  "mdl/ref.md",
  [
    "# Ref",
    "",
    "basename [b](target.md) path [p](mdl/target.md) anchor [a](target.md#sec)",
    'titled [t](target.md "My Title") wiki [[target]] too.',
    "external [e](https://example.com) and self [s](#heading) stay.",
    "`[c](target.md)` in code stays.",
    "",
  ].join("\n"),
);
await create("mdl/my note.md", "# Spaced\n");
await create("mdl/spaceref.md", "see [s](mdl/my%20note.md) here\n");
await create("mdl/pic.png", "fakebinary");
await create("mdl/imgref.md", "embed ![i](pic.png) and link [l](pic.png) here\n");
await create("mdl/sub/deep.md", "# Deep\n");
await create("mdl/folderref.md", "to [d](mdl/sub/deep.md) deep\n");
await create("mdl/rel/here.md", "# Here\n");
await create("mdl/rel/sib.md", "rel [r](./here.md) and up... \n");
await wait(500);

// ── 1. md link rename: basename / path / anchor / titled + wikilink coexist ──
console.log("— md link rename (target.md → renamed.md) —");
const res = await rename("mdl/target.md", "mdl/renamed.md");
ok("rename changed ≥1 file", res.filesChanged >= 1, JSON.stringify(res));
ok("rename 0 skipped", res.skipped.length === 0, JSON.stringify(res.skipped));
const ref = await read("mdl/ref.md");
ok("basename [b](target.md) → vault-rel [b](mdl/renamed.md)", ref.includes("[b](mdl/renamed.md)"), ref);
ok("path-form [p](mdl/target.md) → [p](mdl/renamed.md)", (ref.match(/\[p\]\(mdl\/renamed\.md\)/) || []).length === 1, ref);
ok("anchor [a](target.md#sec) → [a](mdl/renamed.md#sec)", ref.includes("[a](mdl/renamed.md#sec)"), ref);
ok('titled [t](… "My Title") preserves title', ref.includes('[t](mdl/renamed.md "My Title")'), ref);
ok("coexisting wikilink [[target]] → [[renamed]]", ref.includes("[[renamed]]"), ref);
ok("external [e](https://example.com) UNTOUCHED", ref.includes("[e](https://example.com)"), ref);
ok("self-anchor [s](#heading) UNTOUCHED", ref.includes("[s](#heading)"), ref);
ok("code `[c](target.md)` UNTOUCHED", ref.includes("`[c](target.md)`"), ref);
ok("no stray 'target.md' outside the code span", (ref.match(/target\.md/g) || []).length === 1, ref);

// ── 2. %20-encoded path ──────────────────────────────────────────────────────
console.log("— %20-encoded href —");
await rename("mdl/my note.md", "mdl/my note 2.md");
const sref = await read("mdl/spaceref.md");
ok("[s](mdl/my%20note.md) → [s](mdl/my%20note%202.md)", sref.includes("[s](mdl/my%20note%202.md)"), sref);

// ── 3. md image embed IS now rewritten (R243: indexed, ! preserved); md link too ─────
console.log("— md image embed rewrite (R243) —");
await rename("mdl/pic.png", "mdl/pic2.png");
const iref = await read("mdl/imgref.md");
ok("image embed ![i](pic.png) → ![i](mdl/pic2.png) (R243: now rewritten, ! preserved)", iref.includes("![i](mdl/pic2.png)"), iref);
ok("md LINK [l](pic.png) → [l](mdl/pic2.png) (attachment link rewritten)", iref.includes("[l](mdl/pic2.png)"), iref);

// ── 4. folder move rewrites path-form md links ───────────────────────────────
console.log("— folder move —");
await rename("mdl/sub", "mdl/sub2");
const fref = await read("mdl/folderref.md");
ok("[d](mdl/sub/deep.md) → [d](mdl/sub2/deep.md)", fref.includes("[d](mdl/sub2/deep.md)"), fref);

// ── 5. relative ../ / ./ href resolved + rewritten to vault-rel ──────────────
console.log("— relative href —");
await rename("mdl/rel/here.md", "mdl/rel/here2.md");
const rref = await read("mdl/rel/sib.md");
ok("relative [r](./here.md) → [r](mdl/rel/here2.md)", rref.includes("[r](mdl/rel/here2.md)"), rref);

// ── 5b. rename INTO a special-char filename: encode ( ) # space (review A) ──
console.log("— encode special-char target name —");
await create("mdl/paren.md", "# Paren\n");
await create("mdl/pref.md", "see [p](paren.md) and [pa](mdl/paren.md) here\n");
await wait(200);
const pres = await rename("mdl/paren.md", "mdl/pa ren(1).md");
ok("rename into '( ) space' name: 0 skipped (no dangling link)", pres.skipped.length === 0, JSON.stringify(pres));
const pref = await read("mdl/pref.md");
ok("href percent-encoded [p](mdl/pa%20ren%281%29.md)", pref.includes("[p](mdl/pa%20ren%281%29.md)"), pref);
ok("no raw unencoded '(' left in href", !pref.includes("ren(1)"), pref);

// ── 5c. ?query + #anchor tail preserved (review D) ──────────────────────────
console.log("— ?query + #anchor preserved —");
await create("mdl/qtarget.md", "# Q\n");
await create("mdl/qref.md", "q [q](qtarget.md?v=1#sec) here\n");
await wait(200);
await rename("mdl/qtarget.md", "mdl/qtarget2.md");
const qref = await read("mdl/qref.md");
ok("?query + #anchor tail preserved: [q](mdl/qtarget2.md?v=1#sec)", qref.includes("[q](mdl/qtarget2.md?v=1#sec)"), qref);

// ── 5d. md link consumers resolve by kind (review B: backlinks + no ghost) ──
console.log("— meta.links consumers resolve md hrefs by kind —");
await create("mdl/btarget.md", "# BTarget\n");
await create("mdl/bref.md", "anchored [a](btarget.md#sec) and encoded [e](mdl/btarget.md) links\n");
await wait(250);
const bl = await app(() => window.__app.metadata.getBacklinks("mdl/btarget.md").map((e) => e.sourcePath));
ok("anchored/encoded md links counted as backlinks of btarget.md", bl.includes("mdl/bref.md"), JSON.stringify(bl));
const ghosts = await app(() =>
  window.__app.metadata.getGraph().nodes.filter((n) => !n.resolved && n.id.includes("btarget")).map((n) => n.id),
);
ok("no ghost unresolved graph node for the anchored md href", ghosts.length === 0, JSON.stringify(ghosts));

// ── 6. wikilink-only regression (engine still rewrites wikilinks) ────────────
console.log("— wikilink regression —");
await create("mdl/wonly.md", "# WOnly\n");
await create("mdl/wref.md", "pure [[wonly]] wikilink\n");
await wait(200);
await rename("mdl/wonly.md", "mdl/wonly2.md");
const wref = await read("mdl/wref.md");
ok("plain wikilink [[wonly]] → [[wonly2]] (no regression)", wref.includes("[[wonly2]]"), wref);

console.log(`\nR70 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
