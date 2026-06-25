/**
 * R216 — G3 §12: editor:move-heading (Obsidian "Move current heading to a new note").
 * Moves the section under the cursor (heading line + body, through the next same-or-higher
 * heading) into a new note named from the heading, leaving a [[link]] — reusing R44's
 * extract write path; only the range differs (computed by core/moveHeading.headingSectionAt).
 * Browser :1420.  Run: node .calibration/r216-e2e.mjs
 * Contract: ARCHITECTURE "Round 216 additions".
 *
 *  A. pure headingSection (window.__geodeComposer.headingSection): ranges + fence-awareness.
 *  B. end-to-end: cursor in a section → editor:move-heading → new note + byte-exact source.
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
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r216", name: "r216", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeComposer && !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hs = (text, pos) => app(([t, p]) => window.__geodeComposer.headingSection(t, p), [text, pos]);

console.log("A. pure headingSection (ranges, nesting, fence-awareness)");
const T = "# A\naaa\n\n## B\nbbb\n\n## C\nccc\n"; // B starts @9, C starts @19, len 28
ok("middle section [from,to) trims trailing blank lines", JSON.stringify(await hs(T, 14)) === JSON.stringify({ from: 9, to: 17 }), JSON.stringify(await hs(T, 14)));
ok("cursor on the heading line picks that section", JSON.stringify(await hs(T, 9)) === JSON.stringify({ from: 9, to: 17 }));
ok("last section runs to EOF (trailing newline trimmed)", JSON.stringify(await hs(T, 25)) === JSON.stringify({ from: 19, to: 27 }), JSON.stringify(await hs(T, 25)));
ok("cursor before the first heading → null", (await hs("intro\n# A\nx\n", 2)) === null);
// nesting: a deeper subheading moves only the subsection; the parent line moves all of it
const N = "## B\nbbb\n### Sub\nsss\n## C\n"; // B@0, Sub@9, C@21
ok("cursor in a nested subsection → only the subsection", JSON.stringify(await hs(N, 12)) === JSON.stringify({ from: 9, to: 20 }), JSON.stringify(await hs(N, 12)));
ok("cursor on the parent heading → parent through its subsections", JSON.stringify(await hs(N, 0)) === JSON.stringify({ from: 0, to: 20 }), JSON.stringify(await hs(N, 0)));
// a `## x` inside a code fence is NOT a heading boundary
const F = "# Real\nbody\n```\n## Fake\n```\nmore\n## After\nx\n";
const fSec = await hs(F, 8); // cursor in "body"
ok("fenced '## Fake' is not a heading — section spans the fence", fSec !== null && fSec.from === 0 && F.slice(fSec.from, fSec.to).includes("## Fake"), JSON.stringify(fSec));

console.log("B. end-to-end move → new note + byte-exact source");
const setCur = (p) => app((x) => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: x, head: x } }); }, p);
const SRC = "MoveSrc.md";
const srcContent = "# Keep\nintro\n\n## Move Me\nmoved body line\n\n## After\nafter body\n";
await app(([p, c]) => window.__app.vault.create(p, c).catch(() => {}), [SRC, srcContent]);
await wait(40);
await app((p) => window.__app.workspace.openFile(p), SRC);
await wait(150);
await setCur(srcContent.indexOf("moved body line") + 3); // cursor inside the Move Me section
await wait(40);
await app(() => window.__app.commands.execute("editor:move-heading"));
await wait(200);
ok("move creates a new note named from the heading", await app(() => window.__app.vault.fileExists("Move Me.md")));
ok("new note holds the heading + body verbatim",
  (await app(() => window.__app.vault.read("Move Me.md"))) === "## Move Me\nmoved body line\n",
  JSON.stringify(await app(() => window.__app.vault.read("Move Me.md").catch(() => "(missing)"))));
const srcNow = await app((p) => window.__app.documents.get(p)?.getText() ?? "", SRC);
ok("source: section replaced by [[link]], spacing + sibling heading preserved (byte-exact)",
  srcNow === "# Keep\nintro\n\n[[Move Me]]\n\n## After\nafter body\n", JSON.stringify(srcNow));
ok("source no longer holds the moved body", !srcNow.includes("moved body line"));

console.log("C. cursor not in a section → no-op (no note, source unchanged)");
const SRC2 = "MoveSrc2.md";
const src2 = "intro paragraph only\nno heading here\n";
await app(([p, c]) => window.__app.vault.create(p, c).catch(() => {}), [SRC2, src2]);
await wait(40);
await app((p) => window.__app.workspace.openFile(p), SRC2);
await wait(150);
await setCur(3);
await wait(40);
const filesBefore = await app(() => window.__app.vault.getFiles().length);
await app(() => window.__app.commands.execute("editor:move-heading"));
await wait(150);
ok("no-op: no new note created", (await app(() => window.__app.vault.getFiles().length)) === filesBefore);
ok("no-op: source unchanged", (await app((p) => window.__app.documents.get(p)?.getText() ?? "", SRC2)) === src2);

console.log("D. frontmatter safety (R216 review: a `# ` YAML comment must NOT be a heading)");
// pure: a column-0 `# c` inside frontmatter is blanked → not a heading; body has none → null
ok("frontmatter `# comment` is not a heading (no false section → no corruption)",
  (await hs("---\n# c\ntitle: x\n---\nbody\n", 22)) === null, JSON.stringify(await hs("---\n# c\ntitle: x\n---\nbody\n", 22)));
// end-to-end: a real move below frontmatter leaves the frontmatter byte-intact
const SRC3 = "MoveFm.md";
const src3 = "---\ntags: a\n---\n# One\nobody\n\n# Two\ntbody\n";
await app(([p, c]) => window.__app.vault.create(p, c).catch(() => {}), [SRC3, src3]);
await wait(40);
await app((p) => window.__app.workspace.openFile(p), SRC3);
await wait(150);
await setCur(src3.indexOf("tbody") + 2);
await wait(40);
await app(() => window.__app.commands.execute("editor:move-heading"));
await wait(200);
ok("move below frontmatter: new note holds the section", (await app(() => window.__app.vault.read("Two.md").catch(() => "(missing)"))) === "# Two\ntbody\n");
ok("move below frontmatter: source keeps frontmatter + sibling intact (byte-exact)",
  (await app((p) => window.__app.documents.get(p)?.getText() ?? "", SRC3)) === "---\ntags: a\n---\n# One\nobody\n\n[[Two]]\n",
  JSON.stringify(await app((p) => window.__app.documents.get(p)?.getText() ?? "", SRC3)));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR216: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
