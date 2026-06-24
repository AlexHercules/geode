/**
 * R192 — G3 missing→done: editor:clear-formatting (Obsidian "Clear formatting") —
 * browser :1420. Run: node .calibration/r192-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 192 additions".
 *
 * Byte-critical: syntax-tree based, removes ONLY real mark tokens of emphasis/code nodes
 * FULLY inside the selection. Drives the live CM view and asserts exact doc bytes. The
 * key safety case is `a*b*c` inside a code span → literal asterisks survive (not an
 * EmphasisMark), and a partial selection never unbalances a marker.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r192", name: "r192", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("— command registered + name resolves + no default hotkey —");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "editor:clear-formatting");
  return { present: !!c, name: c ? c.name() : null, hk: window.__app.commands.getEffectiveHotkey("editor:clear-formatting") || null };
});
ok("editor:clear-formatting registered", reg.present);
ok("name resolves (not raw key)", !!reg.name && !reg.name.startsWith("cmd."), reg.name);
ok("has no default hotkey (Obsidian parity)", reg.hk === null, reg.hk);

// open an editor in live mode
await app(async () => { try { await window.__app.vault.create("r192cf.md", "x\n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("r192cf.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);

// set whole-doc content, select [from,to], run clear-formatting, return resulting doc
async function clearOn(content, from, to) {
  await app(([c, f, t]) => {
    const v = window.__app.documents.getActiveView().view;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c }, selection: { anchor: f, head: t } });
  }, [content, from, to]);
  await wait(140); // let the markdown parse settle so syntaxTree is complete
  await app(() => window.__app.commands.execute("editor:clear-formatting"));
  await wait(80);
  return app(() => window.__app.documents.getActiveView().view.state.doc.toString());
}

console.log("— strips bold / italic / strikethrough / inline code (exact bytes) —");
ok("**bold** → bold", (await clearOn("**bold**\n", 0, 8)) === "bold\n");
ok("*italic* → italic", (await clearOn("*italic*\n", 0, 8)) === "italic\n");
ok("~~strike~~ → strike", (await clearOn("~~strike~~\n", 0, 10)) === "strike\n");
ok("`code` → code", (await clearOn("`code`\n", 0, 6)) === "code\n");

console.log("— BYTE SAFETY: literal * inside a code span survives —");
ok("`a*b*c` → a*b*c (NOT abc — inner * is not an EmphasisMark)", (await clearOn("`a*b*c`\n", 0, 7)) === "a*b*c\n", await clearOn("`a*b*c`\n", 0, 7));

console.log("— partial selection never unbalances a marker (no corruption) —");
ok("select only 'bold' inside **bold** → unchanged (node not fully contained)", (await clearOn("**bold**\n", 2, 6)) === "**bold**\n", await clearOn("**bold**\n", 2, 6));

console.log("— multiple spans + surrounding text preserved —");
ok("'**b** and *i*' → 'b and i'", (await clearOn("**b** and *i*\n", 0, 13)) === "b and i\n", await clearOn("**b** and *i*\n", 0, 13));
ok("text outside the selection is untouched", (await clearOn("keep **b** keep\n", 5, 10)) === "keep b keep\n", await clearOn("keep **b** keep\n", 5, 10));

console.log("— no-op cases (no redundant transaction) —");
ok("plain text → unchanged", (await clearOn("plain text\n", 0, 10)) === "plain text\n");
ok("empty selection → unchanged", (await clearOn("**bold**\n", 3, 3)) === "**bold**\n");

console.log("— documented gap: highlight (==) is NOT a Lezer node → deferred, left intact —");
ok("==hl== → unchanged (highlight deferred to v2)", (await clearOn("==hl==\n", 0, 6)) === "==hl==\n", await clearOn("==hl==\n", 0, 6));

console.log("— nested ***bi*** fully cleared —");
ok("***bi*** → bi", (await clearOn("***bi***\n", 0, 8)) === "bi\n", await clearOn("***bi***\n", 0, 8));

console.log("— BYTE SAFETY: Geode regex-overlay structures NOT corrupted (Lezer mis-parses their literal */~) —");
// wikilink / embed / alias are Lezer Link/Image nodes → excluded via ancestor check
ok("[[**x**]] → unchanged (link target literal)", (await clearOn("[[**x**]]\n", 0, 9)) === "[[**x**]]\n", await clearOn("[[**x**]]\n", 0, 9));
ok("[[a|**b**]] → unchanged (alias literal)", (await clearOn("[[a|**b**]]\n", 0, 11)) === "[[a|**b**]]\n", await clearOn("[[a|**b**]]\n", 0, 11));
ok("![[**x**]] → unchanged (embed target literal)", (await clearOn("![[**x**]]\n", 0, 10)) === "![[**x**]]\n", await clearOn("![[**x**]]\n", 0, 10));
// inline / block math are Geode regex overlays (not Lezer nodes) → excluded via protectedSpans
ok("$a*b*c$ → unchanged (math multiplication literal)", (await clearOn("$a*b*c$\n", 0, 7)) === "$a*b*c$\n", await clearOn("$a*b*c$\n", 0, 7));
ok("$a**b**$ → unchanged (inline math literal)", (await clearOn("$a**b**$\n", 0, 8)) === "$a**b**$\n", await clearOn("$a**b**$\n", 0, 8));
ok("$$a**b**$$ → unchanged (block math literal)", (await clearOn("$$a**b**$$\n", 0, 10)) === "$$a**b**$$\n", await clearOn("$$a**b**$$\n", 0, 10));
// frontmatter values are literal YAML
ok("frontmatter k: **v** → unchanged (metadata literal)", (await clearOn("---\nk: **v**\n---\n", 0, 15)) === "---\nk: **v**\n---\n", await clearOn("---\nk: **v**\n---\n", 0, 15));
// mixed: real bold cleared, wikilink preserved
ok("[[**x**]] **y** → [[**x**]] y (wikilink kept, real bold cleared)", (await clearOn("[[**x**]] **y**\n", 0, 15)) === "[[**x**]] y\n", await clearOn("[[**x**]] **y**\n", 0, 15));

console.log("— BYTE SAFETY: %%comment%% bodies are literal (Lezer has no comment node) —");
ok("%%a**b**%% → unchanged (single-line comment literal)", (await clearOn("%%a**b**%%\n", 0, 10)) === "%%a**b**%%\n", await clearOn("%%a**b**%%\n", 0, 10));
ok("block %%\\n**x**\\n%% → unchanged (cross-line comment literal)", (await clearOn("%%\n**x**\n%%\n", 0, 9)) === "%%\n**x**\n%%\n", await clearOn("%%\n**x**\n%%\n", 0, 9));
ok("text %%**c**%% **r** → t %%**c**%% r (comment kept, real bold cleared)", (await clearOn("t %%**c**%% **r**\n", 0, 17)) === "t %%**c**%% r\n", await clearOn("t %%**c**%% **r**\n", 0, 17));
// fence-awareness: a lone %% inside fenced code must NOT open a comment that over-protects later bold
ok("lone %% in fenced code does not over-protect later bold", (await clearOn("```\n%% x\n```\n**b**\n", 0, 18)) === "```\n%% x\n```\nb\n", await clearOn("```\n%% x\n```\n**b**\n", 0, 18));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR192: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
