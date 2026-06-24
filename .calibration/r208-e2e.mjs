/**
 * R208 — G3 §2 missing→done: editor:insert-embed (嵌入内容 `![[]]`). Extends the
 * R33 pure format engine (core/format.ts) with one INSERT-only op, mirroring R189
 * insertWikilink with a leading `!`. Browser :1420.  Run: node .calibration/r208-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 208 additions".
 *
 * A = byte-level __geodeFormat.apply probe (exact FormatEdit) for each context.
 * D = render PROOF: `![[Note]]` renders as an embed (distinct from a `[[Note]]` link).
 * B = command registration + no default hotkey.
 * C = live CM: real command wraps the selection in `![[ ]]`.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r208", name: "r208", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeFormat && !!window.__app && !!window.__geodeRenderMarkdown, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const apply = (op, text, from, to) => app(([o, t, f, u]) => window.__geodeFormat.apply(o, t, f, u), [op, text, from, to]);

console.log("A. insert-embed byte-level (`![[]]`, mirror of wikilink + leading `!`)");
let e = await apply("embed", "", 0, 0);
ok("empty sel → '![[]]' cursor between the brackets (selFrom=3)", e?.insert === "![[]]" && e.from === 0 && e.to === 0 && e.selFrom === 3 && e.selTo === 3, JSON.stringify(e));
e = await apply("embed", "ab", 1, 1);
ok("mid-text empty sel → '![[]]' at cursor, caret = from+3 = 4", e?.insert === "![[]]" && e.from === 1 && e.to === 1 && e.selFrom === 4, JSON.stringify(e));
e = await apply("embed", "Note", 0, 4);
ok("sel 'Note' → '![[Note]]' cursor after close (selFrom=9)", e?.insert === "![[Note]]" && e.selFrom === 9 && e.selTo === 9, JSON.stringify(e));
e = await apply("embed", "a Note b", 2, 6);
ok("middle sel 'Note' → '![[Note]]', span = [2,6] only", e?.insert === "![[Note]]" && e.from === 2 && e.to === 6 && e.selFrom === 11, JSON.stringify(e));
e = await apply("embed", "x", 0, 1);
ok("distinct from wikilink: starts with '![[' (embed, not a plain link)", e?.insert.startsWith("![[") && e.insert === "![[x]]", JSON.stringify(e));
// contrast: the wikilink op on the same input has NO leading '!'
const w = await apply("wikilink", "x", 0, 1);
ok("CONTRAST: wikilink op gives '[[x]]' (no '!'), embed gives '![[x]]'", w?.insert === "[[x]]" && e.insert === "![[x]]", JSON.stringify({ w, e }));
// NOTE: embed RENDERING (`![[Note]]` → a note/media embed) is gated behind the
// noteEmbeds option + a resolver (R12/R26/R61, covered by their suites). The bare
// __geodeRenderMarkdown probe omits those, so it shows `!`+link — that is the
// probe's design, not the command's concern. r208 proves the insert SYNTAX only.

console.log("B. command registration + no default hotkey (Obsidian '未设置')");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "editor:insert-embed");
  return { present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey("editor:insert-embed") || null };
});
ok("editor:insert-embed registered", reg.present);
ok("name resolves (not raw 'cmd.' key)", !!reg.name && !reg.name.startsWith("cmd."), String(reg.name));
ok("name is 'Insert embed' (EN)", reg.name === "Insert embed", String(reg.name));
ok("has NO default hotkey", reg.hotkey === null, String(reg.hotkey));

console.log("C. live CM view: real command wraps selection in `![[ ]]`");
await app(async () => { try { await window.__app.vault.create("r208.md", "see Target here\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r208.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);
// select "Target" (offset 4..10 in "see Target here\n")
await app(() => window.__app.documents.getActiveView().view.dispatch({ selection: { anchor: 4, head: 10 } }));
await wait(60);
await app(() => window.__app.commands.execute("editor:insert-embed"));
await wait(100);
const after = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("live: 'Target' → '![[Target]]', surrounding text intact", after === "see ![[Target]] here\n", JSON.stringify(after));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR208: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
