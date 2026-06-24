/**
 * R201 — G3 §4: editor:follow-link (⌥Enter) / editor:open-link-in-new-leaf (⌘Enter).
 * Navigate the link under the cursor (core/linkAtCursor + vetted openWikilink /
 * resolveMarkdownLink / window.open). Browser :1420.   Run: node .calibration/r201-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 201 additions".
 *
 * A = byte-level linkAtCursor via __geodeLinkAtCursor. B = registration + hotkeys.
 * C = live CM: follow (same tab) / new-leaf (new tab) / subpath / markdown / external / no-op.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r201", name: "r201", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeLinkAtCursor, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lac = (line, lineStart, cursor) => app(([l, s, c]) => window.__geodeLinkAtCursor(l, s, c), [line, lineStart, cursor]);

console.log("A. byte-level linkAtCursor (__geodeLinkAtCursor)");
let r = await lac("see [[B]] x", 0, 6); // cursor inside [[B]]
ok("wikilink: cursor in '[[B]]' → {wikilink,B,'',external:false}", r && r.kind === "wikilink" && r.target === "B" && r.subpath === "" && r.external === false && r.from === 4 && r.to === 9, JSON.stringify(r));
r = await lac("x [[Note#Heading]] y", 0, 8);
ok("wikilink subpath: '[[Note#Heading]]' → target Note, subpath Heading", r && r.target === "Note" && r.subpath === "Heading", JSON.stringify(r));
r = await lac("[[Note#H|Alias]]", 0, 3);
ok("wikilink alias dropped: '[[Note#H|Alias]]' → target Note, subpath H", r && r.target === "Note" && r.subpath === "H", JSON.stringify(r));
r = await lac("![[Note]]", 0, 4);
ok("embed '![[Note]]' → wikilink target Note, span from 0 (incl '!')", r && r.kind === "wikilink" && r.target === "Note" && r.from === 0, JSON.stringify(r));
r = await lac("[[#Heading]]", 0, 4);
ok("self-link '[[#Heading]]' → target '', subpath Heading", r && r.target === "" && r.subpath === "Heading", JSON.stringify(r));
r = await lac("a [text](Note.md) b", 0, 11);
ok("markdown internal '[text](Note.md)' → {markdown,Note.md,external:false}", r && r.kind === "markdown" && r.target === "Note.md" && r.external === false, JSON.stringify(r));
r = await lac("[text](Note#H)", 0, 9);
ok("markdown subpath '[text](Note#H)' → target Note, subpath H", r && r.kind === "markdown" && r.target === "Note" && r.subpath === "H", JSON.stringify(r));
r = await lac("[t](https://example.com)", 0, 12);
ok("markdown external → external:true, target full URL", r && r.kind === "markdown" && r.external === true && r.target === "https://example.com", JSON.stringify(r));
r = await lac("[t](https://x.com#frag)", 0, 10);
ok("markdown external+frag → external:true, target https://x.com, subpath frag", r && r.external === true && r.target === "https://x.com" && r.subpath === "frag", JSON.stringify(r));
r = await lac("[w](https://en.wikipedia.org/wiki/Foo_(bar))", 0, 14);
ok("markdown balanced-paren URL not truncated → target keeps '(bar)'", r && r.kind === "markdown" && r.target === "https://en.wikipedia.org/wiki/Foo_(bar)" && r.external === true, JSON.stringify(r));
r = await lac("plain text no link", 0, 5);
ok("no link under cursor → null", r === null, JSON.stringify(r));
r = await lac("a [[X]] b [[Y]] c", 0, 12); // cursor in second link [[Y]]
ok("two links: picks the one under the cursor ([[Y]])", r && r.target === "Y", JSON.stringify(r));
r = await lac("[[Z]]", 0, 0); // cursor at the very start (boundary, inclusive)
ok("boundary: cursor at link start (incl) → matched", r && r.target === "Z", JSON.stringify(r));

console.log("B. command registration + Obsidian-faithful hotkeys");
const reg = await app(() => {
  const f = window.__app.commands.list().find((x) => x.id === "editor:follow-link");
  const n = window.__app.commands.list().find((x) => x.id === "editor:open-link-in-new-leaf");
  return {
    fPresent: !!f, fName: f ? f.name() : null, fKey: window.__app.commands.getEffectiveHotkey("editor:follow-link") || null,
    nPresent: !!n, nName: n ? n.name() : null, nKey: window.__app.commands.getEffectiveHotkey("editor:open-link-in-new-leaf") || null,
  };
});
ok("editor:follow-link registered + name resolves", reg.fPresent && !!reg.fName && !reg.fName.startsWith("cmd."), JSON.stringify(reg));
ok("editor:follow-link default hotkey = Alt+Enter", reg.fKey === "Alt+Enter", reg.fKey);
ok("editor:open-link-in-new-leaf registered + name resolves", reg.nPresent && !!reg.nName && !reg.nName.startsWith("cmd."), JSON.stringify(reg));
ok("editor:open-link-in-new-leaf default hotkey = Mod+Enter", reg.nKey === "Mod+Enter", reg.nKey);

console.log("C. live CM: navigation");
await app(async () => {
  const mk = async (p, c) => { try { await window.__app.vault.create(p, c); } catch { /* exists */ } };
  await mk("B201.md", "# Hi\nbody\n");
  await mk("C201.md", "cee\n");
  await mk("A201.md", "[[B201]]\n[[B201#Hi]]\n[md](C201.md)\n[ext](https://e201.example.com)\nplain line\n`[[GhostInline]]`\n```\n[[GhostFence]]\n```\n");
});
const openA = async () => { await app(() => window.__app.workspace.openFile("A201.md")); await wait(120); };
const allTabFiles = () => app(() => {
  const walk = (n) => (n.tabs ? n.tabs : (n.children || []).flatMap(walk));
  return walk(window.__app.workspace.state.get().root).map((t) => t.filePath);
});
const activeFile = () => app(() => window.__app.workspace.getActiveFile());
const cursorIn = (sub, off) => app(([s, o]) => {
  const v = window.__app.documents.getActiveView().view;
  const idx = v.state.doc.toString().indexOf(s);
  v.dispatch({ selection: { anchor: idx + o } });
}, [sub, off]);
const exec = (id) => app((i) => window.__app.commands.execute(i), id);

await openA();
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "live"); });
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(120);

// no-op: cursor on a plain line
await cursorIn("plain line", 3);
await exec("editor:follow-link");
await wait(100);
ok("no link under cursor → no navigation (still A201)", (await activeFile()) === "A201.md", await activeFile());

// follow wikilink in the SAME tab
await cursorIn("[[B201]]", 3);
await exec("editor:follow-link");
await wait(150);
ok("follow-link on '[[B201]]' → active file = B201 (same tab)", (await activeFile()) === "B201.md", await activeFile());
ok("follow-link reused the tab (1 tab total)", (await allTabFiles()).length === 1, JSON.stringify(await allTabFiles()));

// open-link-in-new-leaf → new tab
await openA();
await cursorIn("[[B201]]", 3);
await exec("editor:open-link-in-new-leaf");
await wait(150);
let tabs = await allTabFiles();
ok("open-link-in-new-leaf → active file = B201", (await activeFile()) === "B201.md", await activeFile());
ok("open-link-in-new-leaf opened a NEW tab (2 tabs: A201 + B201)", tabs.length === 2 && tabs.includes("A201.md") && tabs.includes("B201.md"), JSON.stringify(tabs));
// close the B201 tab to reset
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.closeTab(t.id); });
await wait(120);

// subpath wikilink
await openA();
await cursorIn("[[B201#Hi]]", 3);
await exec("editor:follow-link");
await wait(150);
ok("follow-link on '[[B201#Hi]]' → active file = B201 (subpath navigates)", (await activeFile()) === "B201.md", await activeFile());

// markdown internal
await openA();
await cursorIn("[md](C201.md)", 1);
await exec("editor:follow-link");
await wait(150);
ok("follow-link on '[md](C201.md)' → active file = C201 (markdown internal)", (await activeFile()) === "C201.md", await activeFile());

// external markdown → window.open (stubbed)
await openA();
await app(() => { window.__lastOpen = null; window.open = (u) => { window.__lastOpen = u; return null; }; });
await cursorIn("[ext](https://e201.example.com)", 1);
await exec("editor:follow-link");
await wait(120);
ok("follow-link on external '[ext](https://…)' → window.open the URL (no navigation)", (await app(() => window.__lastOpen)) === "https://e201.example.com" && (await activeFile()) === "A201.md", await app(() => window.__lastOpen));

// code-context guard: a [[link]] that is literal inside inline code / a fence must NOT
// navigate or create a phantom note (else openWikilink would write GhostInline/Fence.md)
const fileExists = (p) => app((path) => !!window.__app.vault.getAbstractFileByPath?.(path) || (window.__app.metadata.byPath?.has?.(path) ?? false), p);
await openA();
await cursorIn("[[GhostInline]]", 3); // cursor sits inside the inline-code span
await exec("editor:follow-link");
await wait(120);
ok("inline-code '`[[GhostInline]]`' → follow-link no-op (still A201, no phantom note)", (await activeFile()) === "A201.md", await activeFile());
await openA();
await cursorIn("[[GhostFence]]", 3); // cursor inside a ``` fenced block
await exec("editor:follow-link");
await wait(120);
ok("fenced-code '[[GhostFence]]' → follow-link no-op (still A201, no phantom note)", (await activeFile()) === "A201.md", await activeFile());
ok("no phantom notes created (GhostInline/GhostFence absent)", !(await fileExists("GhostInline.md")) && !(await fileExists("GhostFence.md")));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR201: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
