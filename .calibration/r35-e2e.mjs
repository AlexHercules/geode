/**
 * R35 bracket/quote auto-pair + selection-wrap E2E — browser mode (Memory vault)
 * against dev :1420. Run: node .calibration/r35-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 35 additions".
 *
 * Covers:
 *  A. probe (window.__geodeBrackets.wrap): the PURE markdown selection-wrap
 *     decision (core/bracketWrap.markdownWrapInput) — wrap shape, additive
 *     selection, empty-selection / non-marker → null.
 *  B. live CM editor + REAL keyboard (the closeBrackets() behaviors a live view
 *     is required for — R34 conclusion):
 *       - auto-close ( [ { " '  (empty selection → pair, cursor inside)
 *       - type-over  ()| + ) → ()  (skip, no double)
 *       - Backspace deletes the empty pair
 *       - selection-wrap brackets  foo + ( → (foo)
 *       - selection-wrap markdown  foo + * → *foo*  → ** again → **foo**
 *       - empty selection + * → just *  (deliberate deviation, no empty-pairing)
 *       - wikilink coordination: [[ → [[]] (no double ]]), literal [[Note]]
 *         round-trips, completion accept yields single ]] (sliceDoc guard)
 *       - autosave: a paired insert persists to the vault past the debounce
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r35", name: "r35", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeBrackets, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 40));
}, [p, c]);

const SCRATCH = "r35/scratch.md";
const getDoc = () => app((p) => window.__app.documents.get(p)?.getText() ?? "", SCRATCH);
const openLive = (path) => app(async (p) => {
  window.__app.workspace.openFile(p);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
}, path);

// clear the editor to empty via select-all + delete, then verify.
async function clearEditor() {
  await page.click(".cm-content");
  await page.keyboard.press("Escape"); // dismiss any open completion tooltip
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
  await wait(60);
}

// ── A. probe (pure markdown selection-wrap decision) ─────────────────────────
console.log("A. probe (window.__geodeBrackets.wrap — pure decision)");

const w1 = await app(() => window.__geodeBrackets.wrap("foo", 0, 3, "*"));
ok("wrap(foo,0,3,*) inserts *foo*",
  w1 && w1.changes.insert === "*foo*", JSON.stringify(w1));
ok("wrap(foo,0,3,*) selection covers inner (anchor 1, head 4 → additive)",
  w1 && w1.selection.anchor === 1 && w1.selection.head === 4, JSON.stringify(w1 && w1.selection));
ok("wrap(foo,0,3,`) inserts `foo`",
  (await app(() => window.__geodeBrackets.wrap("foo", 0, 3, "`")))?.changes.insert === "`foo`");
ok("wrap(foo,0,3,=) inserts =foo=",
  (await app(() => window.__geodeBrackets.wrap("foo", 0, 3, "=")))?.changes.insert === "=foo=");
ok("wrap empty selection (1,1,*) → null",
  (await app(() => window.__geodeBrackets.wrap("foo", 1, 1, "*"))) === null);
ok("wrap non-marker char (0,3,x) → null",
  (await app(() => window.__geodeBrackets.wrap("foo", 0, 3, "x"))) === null);
ok("wrap bracket char (0,3,'(') → null (brackets handled by closeBrackets, not this)",
  (await app(() => window.__geodeBrackets.wrap("foo", 0, 3, "("))) === null);

// ── B. live CM editor + real keyboard ────────────────────────────────────────
console.log("B. live CM editor (closeBrackets via real keystrokes)");

await create(SCRATCH, "");
await openLive(SCRATCH);
await page.waitForSelector(".cm-content", { timeout: 4000 });

// auto-close on empty selection
for (const [open, want] of [["(", "()"], ["[", "[]"], ["{", "{}"], ['"', '""']]) {
  await clearEditor();
  await page.keyboard.type(open, { delay: 25 });
  await wait(80);
  ok(`type "${open}" auto-closes → ${want}`, (await getDoc()) === want, JSON.stringify(await getDoc()));
}

// quote auto-close at line start (empty → pairs)
await clearEditor();
await page.keyboard.type("'", { delay: 25 });
await wait(80);
ok("type \"'\" at line start auto-closes → ''", (await getDoc()) === "''", JSON.stringify(await getDoc()));

// contraction-safe: ' after a word char does NOT pair (CM quote-before-word guard)
await clearEditor();
await page.keyboard.type("don", { delay: 25 });
await page.keyboard.type("'", { delay: 25 });
await page.keyboard.type("t", { delay: 25 });
await wait(80);
ok("\"don'\" + t → \"don't\" (apostrophe in contraction, no pair)",
  (await getDoc()) === "don't", JSON.stringify(await getDoc()));

// type-over: ()| then ) → still ()
await clearEditor();
await page.keyboard.type("(", { delay: 25 });
await page.keyboard.type(")", { delay: 25 });
await wait(80);
ok('type "(" then ")" → "()" (type-over, no double)', (await getDoc()) === "()", JSON.stringify(await getDoc()));

// Backspace deletes the empty pair
await clearEditor();
await page.keyboard.type("(", { delay: 25 });
await wait(60);
await page.keyboard.press("Backspace");
await wait(80);
ok('"(|)" + Backspace deletes both brackets → ""', (await getDoc()) === "", JSON.stringify(await getDoc()));

// selection-wrap with a bracket
await clearEditor();
await page.keyboard.type("foo", { delay: 25 });
await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
await page.keyboard.type("(", { delay: 25 });
await wait(80);
ok('select "foo" + "(" wraps → (foo)', (await getDoc()) === "(foo)", JSON.stringify(await getDoc()));

// selection-wrap with markdown emphasis, then additive
await clearEditor();
await page.keyboard.type("foo", { delay: 25 });
await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
await page.keyboard.type("*", { delay: 25 });
await wait(80);
ok('select "foo" + "*" wraps → *foo*', (await getDoc()) === "*foo*", JSON.stringify(await getDoc()));
await page.keyboard.type("*", { delay: 25 }); // inner still selected → additive
await wait(80);
ok('then "*" again (additive) → **foo**', (await getDoc()) === "**foo**", JSON.stringify(await getDoc()));

// selection-wrap with backtick
await clearEditor();
await page.keyboard.type("foo", { delay: 25 });
await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
await page.keyboard.type("`", { delay: 25 });
await wait(80);
ok('select "foo" + "`" wraps → `foo`', (await getDoc()) === "`foo`", JSON.stringify(await getDoc()));

// empty-selection markdown char does NOT pair (deliberate deviation)
await clearEditor();
await page.keyboard.type("*", { delay: 25 });
await wait(80);
ok('type "*" on empty selection → just "*" (no empty-pairing)', (await getDoc()) === "*", JSON.stringify(await getDoc()));

// wikilink coordination: [[ → [[]] (closeBrackets pairs the inner ])
await clearEditor();
await page.keyboard.type("[[", { delay: 30 });
await wait(120);
ok('type "[[" → "[[]]" (no double, ready for completion)', (await getDoc()) === "[[]]", JSON.stringify(await getDoc()));
await page.keyboard.press("Escape"); // dismiss completion

// literal [[Note]] round-trips (type-over absorbs the typed closers)
await clearEditor();
await page.keyboard.type("[[Note", { delay: 30 });
await page.keyboard.press("Escape"); // dismiss completion before typing closers
await page.keyboard.type("]]", { delay: 30 });
await wait(100);
ok('literal "[[Note]]" round-trips (type-over, no extra ]])',
  (await getDoc()) === "[[Note]]", JSON.stringify(await getDoc()));

// wikilink completion accept → single ]] (the apply sliceDoc guard)
await create("r35/Target.md", "# Target\n");
await wait(50);
await clearEditor();
await page.keyboard.type("[[Targ", { delay: 40 });
await wait(250); // CM autocomplete debounce + render
const tip = await page.$(".cm-tooltip-autocomplete");
ok("wikilink completion popup appears after [[Targ", !!tip);
await page.keyboard.press("Enter"); // accept first option
await wait(120);
const linked = await getDoc();
ok('completion accept → "[[Target]]" (single ]], cursor past it)',
  linked === "[[Target]]", JSON.stringify(linked));

// autosave: a paired insert persists to the vault past the debounce
await clearEditor();
await page.keyboard.type("(saved)", { delay: 25 });
await wait(1500);
const onDisk = await app((p) => window.__app.vault.read(p), SCRATCH);
ok("paired insert persists to vault (autosave)", onDisk === "(saved)", JSON.stringify(onDisk));

console.log(`\nR35 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); process.exitCode = 1; }
await browser.close();
process.exit(failed ? 1 : 0);
