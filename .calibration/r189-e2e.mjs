/**
 * R189 — G3 partial→done: editor:insert-wikilink (Obsidian "Insert wikilink", `[[]]`,
 * distinct from the existing editor:insert-link Markdown link) — browser :1420.
 * Run: node .calibration/r189-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 189 additions".
 *
 * A = byte-level pure __geodeFormat.apply probe (exact FormatEdit) — content preserved,
 *     only the [from,to] range is wrapped in [[ ]]. B = command registration + hotkey
 *     boundary. C = live CM view: real command wraps the selection, rest of doc unchanged.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r189", name: "r189", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeFormat && !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const apply = (op, text, from, to) =>
  app(([o, t, f, u]) => window.__geodeFormat.apply(o, t, f, u), [op, text, from, to]);

console.log("A. byte-level transform (pure __geodeFormat.apply)");
// empty selection → [[]] with cursor between the brackets
let e = await apply("wikilink", "", 0, 0);
ok("empty doc, empty sel → '[[]]'", e?.insert === "[[]]", JSON.stringify(e));
ok("empty sel: cursor lands between brackets (selFrom=selTo=2)", e && e.selFrom === 2 && e.selTo === 2, JSON.stringify(e));
ok("empty sel still returns an edit (never no-op)", e !== null);

e = await apply("wikilink", "foobar", 3, 3); // cursor mid-word, no selection
ok("mid-text empty sel → '[[]]' inserted at cursor", e?.insert === "[[]]" && e.from === 3 && e.to === 3, JSON.stringify(e));
ok("mid-text empty sel: cursor between brackets (from+2)", e && e.selFrom === 5 && e.selTo === 5, JSON.stringify(e));

// non-empty selection → [[selected]] with cursor after the closing ]]
e = await apply("wikilink", "foo", 0, 3);
ok("sel 'foo' → '[[foo]]'", e?.insert === "[[foo]]", JSON.stringify(e));
ok("sel 'foo': cursor after ]] (from+len)", e && e.selFrom === 7 && e.selTo === 7, JSON.stringify(e));

e = await apply("wikilink", "x foo y", 2, 5); // wrap the middle "foo"
ok("middle sel 'foo' wrapped, span = [from,to] only", e?.insert === "[[foo]]" && e.from === 2 && e.to === 5, JSON.stringify(e));
ok("middle sel: cursor after ]] (from + insert.length)", e && e.selFrom === 9 && e.selTo === 9, JSON.stringify(e));

// content preservation: markup inside the selection is wrapped verbatim
e = await apply("wikilink", "**bold**", 0, 8);
ok("content preserved: '**bold**' → '[[**bold**]]'", e?.insert === "[[**bold**]]", JSON.stringify(e));

// does NOT unwrap (insert, not toggle): applying again nests
e = await apply("wikilink", "[[foo]]", 0, 7);
ok("not a toggle: '[[foo]]' → '[[[[foo]]]]' (wraps, never unwraps)", e?.insert === "[[[[foo]]]]", JSON.stringify(e));

console.log("B. command registration + hotkey boundary");
const reg = await app(() => {
  const w = window.__app.commands.list().find((x) => x.id === "editor:insert-wikilink");
  const link = window.__app.commands.list().find((x) => x.id === "editor:insert-link");
  return {
    present: !!w,
    name: w ? w.name() : null,
    wHotkey: window.__app.commands.getEffectiveHotkey("editor:insert-wikilink") || null,
    linkHotkey: window.__app.commands.getEffectiveHotkey("editor:insert-link") || null,
  };
});
ok("editor:insert-wikilink registered", reg.present);
ok("name resolves (not raw key)", !!reg.name && !reg.name.startsWith("cmd."), reg.name);
ok("editor:insert-wikilink has NO default hotkey (Obsidian parity)", reg.wHotkey === null, reg.wHotkey);
ok("editor:insert-link still owns Mod+K (not stolen)", reg.linkHotkey === "Mod+K", reg.linkHotkey);

console.log("C. live CM view: real command wraps the selection, rest of doc unchanged");
const CONTENT = "alpha beta gamma\n";
await app(async (c) => { try { await window.__app.vault.create("r189wl.md", c); } catch { /* exists */ } }, CONTENT);
await app(() => {
  window.__app.workspace.openFile("r189wl.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);
// select "beta" (chars 6..10 in "alpha beta gamma")
await app(() => {
  const v = window.__app.documents.getActiveView().view;
  v.dispatch({ selection: { anchor: 6, head: 10 } });
});
await wait(60);
await app(() => window.__app.commands.execute("editor:insert-wikilink"));
await wait(100);
const after = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("live: selection 'beta' → '[[beta]]'", after === "alpha [[beta]] gamma\n", JSON.stringify(after));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR189: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
