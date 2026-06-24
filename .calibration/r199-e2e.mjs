/**
 * R199 — G3 missing→done: editor:insert-footnote (插入脚注). Two-site edit
 * (ref `[^N]` at caret + def `[^N]: ` on the last line) + auto-numbering +
 * bidirectional def→ref jump. Pure logic = core/format.ts insertFootnote.
 * Browser :1420.   Run: node .calibration/r199-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 199 additions".
 *
 * A  = Mode A insert byte-level via __geodeFootnote (exact FootnoteAction).
 * B  = Mode B jump (def line → body ref) incl. the `[^1]`⊄`[^10]` guard.
 * N  = numbering (max+1, gap-not-filled, named ignored) + selection-not-consumed.
 * R  = render proof (footnote-ref sup). C = registration. D = live CM end-to-end.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r199", name: "r199", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeFootnote && !!window.__app && !!window.__geodeRenderMarkdown, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fn = (text, from, to) =>
  app(([t, f, u]) => window.__geodeFootnote(t, f, u), [text, from, to]);
const render = (src) => app((s) => window.__geodeRenderMarkdown(s), src);

console.log("A. Mode A insert byte-level (ref [^N] at caret + def [^N]: on last line)");
let a = await fn("", 0, 0);
ok("empty doc → 2 inserts at 0: '[^1]' + '\\n[^1]: '", a.kind === "insert" && a.changes.length === 2 &&
  a.changes[0].from === 0 && a.changes[0].insert === "[^1]" &&
  a.changes[1].from === 0 && a.changes[1].insert === "\n[^1]: ", JSON.stringify(a));
ok("empty doc selTarget = end (after '[^1]: ') = 11", a.selTarget === 11, JSON.stringify(a));

a = await fn("hello", 5, 5);
ok("no trailing \\n → def lead '\\n', ref at 5, def at L=5", a.kind === "insert" &&
  a.changes[0].from === 5 && a.changes[0].insert === "[^1]" &&
  a.changes[1].from === 5 && a.changes[1].insert === "\n[^1]: " && a.selTarget === 16, JSON.stringify(a));

a = await fn("hello\n", 3, 3);
ok("trailing \\n → def NO lead '\\n' (lands on last empty line), ref at 3, def at L=6", a.kind === "insert" &&
  a.changes[0].from === 3 && a.changes[0].insert === "[^1]" &&
  a.changes[1].from === 6 && a.changes[1].insert === "[^1]: " && a.selTarget === 16, JSON.stringify(a));

console.log("N. numbering (max numeric label + 1, collision-safe) + selection preserved");
a = await fn("a [^1] b\n[^1]: x\n", 0, 0);
ok("existing [^1] → next is [^2]", a.kind === "insert" && a.changes[0].insert === "[^2]" && a.changes[1].insert.includes("[^2]: "), JSON.stringify(a));
a = await fn("[^1] [^5]\n[^1]: \n[^5]: \n", 0, 0);
ok("gap NOT filled: max([^1],[^5])+1 = [^6]", a.kind === "insert" && a.changes[0].insert === "[^6]", JSON.stringify(a));
a = await fn("[^note] x", 9, 9);
ok("named footnote [^note] ignored by numeric scan → [^1]", a.kind === "insert" && a.changes[0].insert === "[^1]", JSON.stringify(a));
a = await fn("important", 0, 9); // whole word selected
ok("底线①: selection NOT consumed — ref inserted at end 'to'=9 (text kept)", a.kind === "insert" &&
  a.changes[0].from === 9 && a.changes[0].insert === "[^1]", JSON.stringify(a));

console.log("B. Mode B jump (caret on def line → first body ref) + prefix-collision guard");
a = await fn("see [^1] here\n[^1]: \n", 16, 16); // caret inside the '[^1]: ' def line
ok("on def line → jump to after body ref '[^1]' (selTarget=8), NO doc change", a.kind === "jump" && a.selTarget === 8, JSON.stringify(a));
a = await fn("[^1]: only def\n", 3, 3); // def line, no body ref
ok("def line but no body ref → stays (jump selTarget=caret=3)", a.kind === "jump" && a.selTarget === 3, JSON.stringify(a));
a = await fn("ref [^10] x\n[^1]: y\n", 14, 14); // def '[^1]:' ; body has [^10] but not [^1]
ok("guard: '[^1]' does NOT match inside '[^10]' → no false jump (stays at 14)", a.kind === "jump" && a.selTarget === 14, JSON.stringify(a));
// indented def line (1-3 spaces) is a valid def to the renderer (tShift) → Mode B too
a = await fn("see [^1] here\n  [^1]: x\n", 18, 18); // caret on the 2-space-indented def line
ok("indented def line (2 spaces) → Mode B jump to body ref (selTarget=8), not a spurious insert", a.kind === "jump" && a.selTarget === 8, JSON.stringify(a));

console.log("R. render proof: inserted footnote renders a footnote-ref sup");
const html = await render("see [^1]\n\n[^1]: my note\n");
ok("'[^1]' + '[^1]: my note' renders sup.footnote-ref", /class="footnote-ref"/.test(html), html);
// lock the LITERAL bytes Mode A emits (no blank line, empty def) — also renders the ref
const emitted = await render("alpha[^1]\n[^1]: ");
ok("Mode A's exact output 'alpha[^1]\\n[^1]: ' (no blank line, empty def) renders sup.footnote-ref", /class="footnote-ref"/.test(emitted), emitted);

console.log("C. command registration + no default hotkey");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "editor:insert-footnote");
  return { present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey("editor:insert-footnote") || null };
});
ok("editor:insert-footnote registered", reg.present);
ok("name resolves (not raw key)", !!reg.name && !reg.name.startsWith("cmd."), String(reg.name));
ok("no default hotkey (Obsidian '未设置')", reg.hotkey === null, String(reg.hotkey));

console.log("D. live CM: insert (incl. same-position change) then bidirectional jump");
await app(async () => { try { await window.__app.vault.create("r199.md", "alpha beta\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r199.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);
// caret at end of "beta" (idx 10, before the trailing \n)
await app(() => window.__app.documents.getActiveView().view.dispatch({ selection: { anchor: 10 } }));
await wait(60);
await app(() => window.__app.commands.execute("editor:insert-footnote"));
await wait(100);
let doc = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("live insert: 'alpha beta' → 'alpha beta[^1]\\n[^1]: '", doc === "alpha beta[^1]\n[^1]: ", JSON.stringify(doc));
let caret = await app(() => window.__app.documents.getActiveView().view.state.selection.main.head);
ok("live insert: caret at end of def marker (doc.length)", caret === doc.length, `${caret} vs ${doc.length}`);
// run AGAIN — caret now on the def line → should JUMP to after the body ref, doc UNCHANGED
await app(() => window.__app.commands.execute("editor:insert-footnote"));
await wait(100);
let doc2 = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
caret = await app(() => window.__app.documents.getActiveView().view.state.selection.main.head);
ok("live jump: 2nd run on def line does NOT add a footnote (doc unchanged)", doc2 === doc, JSON.stringify(doc2));
ok("live jump: caret moved to after body ref '[^1]' (idx 14)", caret === 14, String(caret));

// same-position-change robustness: caret at very end of a no-trailing-\n doc
await app(async () => { try { await window.__app.vault.create("r199b.md", "x"); } catch { /* exists */ } });
await app(() => { window.__app.workspace.openFile("r199b.md"); const tb = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(tb.id, "live"); });
await wait(150);
await app(() => { const v = window.__app.documents.getActiveView().view; v.dispatch({ selection: { anchor: v.state.doc.length } }); });
await wait(60);
await app(() => window.__app.commands.execute("editor:insert-footnote"));
await wait(100);
let docB = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("live same-position change (caret==docEnd): 'x' → 'x[^1]\\n[^1]: '", docB === "x[^1]\n[^1]: ", JSON.stringify(docB));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR199: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
