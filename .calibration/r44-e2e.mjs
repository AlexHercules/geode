/**
 * R44 Note composer (extract selection → new note) E2E — browser vs dev :1420.
 * Run: node .calibration/r44-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 44 additions".
 *
 *  A. pure helpers (window.__geodeComposer): derive / content / replacement.
 *  B. end-to-end: open note → select range → editor:extract-selection →
 *     new note holds the text, source replaces selection with [[link]],
 *     collision suffixes the name, empty selection is a no-op.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r44", name: "r44", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeComposer, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A. pure helpers ──────────────────────────────────────────────────────────
console.log("A. pure helpers (window.__geodeComposer)");
const derive = (s) => app((x) => window.__geodeComposer.derive(x), s);
ok("derive heading → heading text", (await derive("# My Heading\nbody")) === "My Heading");
ok("derive plain → first non-empty line", (await derive("first line\nsecond")) === "first line");
ok("derive skips leading blank lines", (await derive("\n\n  real title\nx")) === "real title");
ok("derive empty → Untitled", (await derive("")) === "Untitled");
ok("derive all-whitespace → Untitled", (await derive("   \n\t  ")) === "Untitled");
ok("derive CJK heading preserved", (await derive("## 中文 标题")) === "中文 标题");
ok("derive sanitizes illegal/wikilink chars", (await derive("a/b:c*d?[e]#f|g")) === "a b c d e f g");
ok("derive '#nospace' strips marker (not a heading)", (await derive("#nospace")) === "nospace");
ok("derive '. .' (dots+space) → Untitled (no '..md' / '[[.]]')", (await derive(". .")) === "Untitled");
ok("derive trailing dot stripped 'note.' → 'note'", (await derive("note.")) === "note");
ok("derive strips control chars (BEL)", (await app(() => window.__geodeComposer.derive("x" + String.fromCharCode(7) + "y"))) === "x y");
const longName = await app(() => window.__geodeComposer.derive("L".repeat(300)));
ok("derive byte-truncates very long names (≤200 bytes)", new TextEncoder().encode(longName).length <= 200 && longName.length > 0, String(longName.length));
ok("content trims trailing newlines to one", (await app(() => window.__geodeComposer.content("text\n\n\n"))) === "text\n");
ok("replacement link", (await app(() => window.__geodeComposer.replacement("Note", "link"))) === "[[Note]]");
ok("replacement embed", (await app(() => window.__geodeComposer.replacement("Note", "embed"))) === "![[Note]]");

// ── B. end-to-end extract ────────────────────────────────────────────────────
console.log("B. end-to-end extract (selection → new note + [[link]])");
const setSel = (f, e) => app(([a, b]) => { const v = window.__app.documents.getActiveView()?.view; if (v) v.dispatch({ selection: { anchor: a, head: b } }); }, [f, e]);

const SRC = "ExtractSrc.md";
const srcContent = "Intro line\nEXTRACT ME\nTail line\n";
await app(([p, c]) => window.__app.vault.create(p, c).catch(() => {}), [SRC, srcContent]);
await wait(40);
await app((p) => window.__app.workspace.openFile(p), SRC);
await wait(150);
const from = srcContent.indexOf("EXTRACT ME");
await setSel(from, from + "EXTRACT ME".length);
await wait(40);
await app(() => window.__app.commands.execute("editor:extract-selection"));
await wait(150);
ok("extract creates a new note named from the selection", await app(() => window.__app.vault.fileExists("EXTRACT ME.md")));
const newContent = await app(() => window.__app.vault.read("EXTRACT ME.md"));
ok("new note holds the extracted text", newContent.trim() === "EXTRACT ME", JSON.stringify(newContent));
const srcNow = await app((p) => window.__app.documents.get(p)?.getText() ?? "", SRC);
ok("source replaces the selection with a wikilink", srcNow.includes("[[EXTRACT ME]]"), JSON.stringify(srcNow));
ok("source no longer holds the raw extracted line", !srcNow.includes("\nEXTRACT ME\n"), JSON.stringify(srcNow));

// collision → suffixed name + link
const SRC2 = "ExtractSrc2.md";
await app(([p, c]) => window.__app.vault.create(p, c).catch(() => {}), [SRC2, "head\nEXTRACT ME\ntail\n"]);
await wait(40);
await app((p) => window.__app.workspace.openFile(p), SRC2);
await wait(150);
await setSel("head\n".length, "head\n".length + "EXTRACT ME".length);
await wait(40);
await app(() => window.__app.commands.execute("editor:extract-selection"));
await wait(150);
ok("collision → new note gets a ' 1' suffix", await app(() => window.__app.vault.fileExists("EXTRACT ME 1.md")));
const src2Now = await app((p) => window.__app.documents.get(p)?.getText() ?? "", SRC2);
ok("collision → link uses the suffixed name", src2Now.includes("[[EXTRACT ME 1]]"), JSON.stringify(src2Now));

// empty selection → no-op (no spurious note, source unchanged)
const SRC3 = "ExtractSrc3.md";
await app(([p, c]) => window.__app.vault.create(p, c).catch(() => {}), [SRC3, "alpha beta\n"]);
await wait(40);
await app((p) => window.__app.workspace.openFile(p), SRC3);
await wait(150);
await setSel(2, 2); // empty selection (cursor only)
await wait(40);
const filesBefore = await app(() => window.__app.vault.getFiles().length);
await app(() => window.__app.commands.execute("editor:extract-selection"));
await wait(120);
const filesAfter = await app(() => window.__app.vault.getFiles().length);
ok("empty selection is a no-op (no new note created)", filesAfter === filesBefore, `${filesBefore}→${filesAfter}`);
ok("empty selection leaves the source unchanged", (await app((p) => window.__app.documents.get(p)?.getText() ?? "", SRC3)) === "alpha beta\n");

// whitespace-only (non-empty) selection → no-op (no empty Untitled note)
const SRC4 = "ExtractSrc4.md";
await app(([p, c]) => window.__app.vault.create(p, c).catch(() => {}), [SRC4, "x   y\n"]);
await wait(40);
await app((p) => window.__app.workspace.openFile(p), SRC4);
await wait(150);
await setSel(1, 4); // the 3 spaces between x and y
await wait(40);
const filesBeforeWs = await app(() => window.__app.vault.getFiles().length);
await app(() => window.__app.commands.execute("editor:extract-selection"));
await wait(120);
ok("whitespace-only selection is a no-op (no empty note)", (await app(() => window.__app.vault.getFiles().length)) === filesBeforeWs);
ok("whitespace-only selection leaves source unchanged", (await app((p) => window.__app.documents.get(p)?.getText() ?? "", SRC4)) === "x   y\n");

console.log(`\nR44 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
