/**
 * R202 — G3 §4: editor:open-link-in-new-split (⌘⌥Enter, "Open link under cursor to the right").
 * Continues R201: same linkAtCursor + open path, but splitActivePane("row") first so the link
 * opens in a NEW split pane. Browser :1420.   Run: node .calibration/r202-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 202 additions".
 *
 * B = registration + Mod+Alt+Enter hotkey. C = live: split opens a new pane on the right for
 *     a wikilink / markdown link; external → browser (no split); code-context → no-op (no split).
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
const context = await browser.newContext();
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r202", name: "r202", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeLinkAtCursor, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = (id) => app((i) => window.__app.commands.execute(i), id);
const activeFile = () => app(() => window.__app.workspace.getActiveFile());
const paneCount = () => app(() => {
  const walk = (n) => (n.tabs ? 1 : (n.children || []).reduce((a, c) => a + walk(c), 0));
  return walk(window.__app.workspace.state.get().root);
});
const cursorIn = (sub, off) => app(([s, o]) => {
  const v = window.__app.documents.getActiveView().view;
  const idx = v.state.doc.toString().indexOf(s);
  v.dispatch({ selection: { anchor: idx + o } });
}, [sub, off]);

console.log("B. registration + Mod+Alt+Enter hotkey");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "editor:open-link-in-new-split");
  return { present: !!c, name: c ? c.name() : null, key: window.__app.commands.getEffectiveHotkey("editor:open-link-in-new-split") || null };
});
ok("editor:open-link-in-new-split registered + name resolves", reg.present && !!reg.name && !reg.name.startsWith("cmd."), JSON.stringify(reg));
ok("default hotkey = Mod+Alt+Enter (⌘⌥Enter)", reg.key === "Mod+Alt+Enter", reg.key);

console.log("C. live: split opens the link in a new pane on the right");
await app(async () => {
  const mk = async (p, c) => { try { await window.__app.vault.create(p, c); } catch { /* exists */ } };
  await mk("B202.md", "# Hi\nbody\n");
  await mk("C202.md", "cee\n");
  await mk("A202.md", "[[B202]]\n[[B202#Hi]]\n[md](C202.md)\n[ext](https://e202.example.com)\nplain\n`[[GhostSplit]]`\nx [[#]] y\n");
});
const openA = async () => { await app(() => window.__app.workspace.openFile("A202.md")); await wait(120); };
await openA();
await app(() => { const t = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(t.id, "live"); });
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(120);

// wikilink → new split pane shows B202
let before = await paneCount();
await cursorIn("[[B202]]", 3);
await exec("editor:open-link-in-new-split");
await wait(180);
ok("split on '[[B202]]' → pane count +1 (new split pane)", (await paneCount()) === before + 1, `${await paneCount()} vs ${before}+1`);
ok("split on '[[B202]]' → active file = B202 (opened in the new pane)", (await activeFile()) === "B202.md", await activeFile());

// markdown internal → new split pane shows C202
await openA();
before = await paneCount();
await cursorIn("[md](C202.md)", 1);
await exec("editor:open-link-in-new-split");
await wait(180);
ok("split on '[md](C202.md)' → pane count +1", (await paneCount()) === before + 1, `${await paneCount()} vs ${before}+1`);
ok("split on '[md](C202.md)' → active file = C202", (await activeFile()) === "C202.md", await activeFile());

// subpath wikilink → split + reveal
await openA();
before = await paneCount();
await cursorIn("[[B202#Hi]]", 3);
await exec("editor:open-link-in-new-split");
await wait(180);
ok("split on '[[B202#Hi]]' → pane +1, active B202 (subpath)", (await paneCount()) === before + 1 && (await activeFile()) === "B202.md", await activeFile());

// external in split mode → browser, NO split pane created
await openA();
before = await paneCount();
await app(() => { window.__lastOpen = null; window.open = (u) => { window.__lastOpen = u; return null; }; });
await cursorIn("[ext](https://e202.example.com)", 1);
await exec("editor:open-link-in-new-split");
await wait(140);
ok("split on external → window.open, NO new pane", (await app(() => window.__lastOpen)) === "https://e202.example.com" && (await paneCount()) === before, `panes ${await paneCount()} vs ${before}`);

// code-context guard in split mode → no-op, NO split, no phantom note
await openA();
before = await paneCount();
await cursorIn("[[GhostSplit]]", 3);
await exec("editor:open-link-in-new-split");
await wait(140);
ok("split on inline-code '`[[GhostSplit]]`' → no-op (no new pane, still A202)", (await paneCount()) === before && (await activeFile()) === "A202.md", `panes ${await paneCount()} vs ${before}`);
ok("no phantom note GhostSplit created", !(await app(() => !!window.__app.vault.getAbstractFileByPath?.("GhostSplit.md"))));

// degenerate '[[#]]' (empty target + subpath) in split mode → no-op, NO stray duplicate pane
await openA();
before = await paneCount();
await cursorIn("[[#]]", 2);
await exec("editor:open-link-in-new-split");
await wait(140);
ok("split on degenerate '[[#]]' → no-op (no stray pane)", (await paneCount()) === before && (await activeFile()) === "A202.md", `panes ${await paneCount()} vs ${before}`);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR202: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
