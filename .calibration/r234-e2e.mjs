/**
 * R234 Note composer "Replace selection with" setting E2E — browser mode :1420.
 * Run: node .calibration/r234-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 234 additions".
 *
 * Obsidian's Note composer "Replace selection with": Link (default) / Embed / None — what to
 * leave in the source note after extracting a selection into a new note. Geode adds a Note
 * composer settings tab with this dropdown (extractReplaceMode Store) and threads it through
 * noteComposerCommands.extractRange (was hardcoded "link"). This suite drives REAL extracts
 * per mode to prove the dropdown→Store→extract wiring, plus persistence.
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
await page.evaluate(() => { try { localStorage.removeItem("geode.extractReplaceMode"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r234", name: "r234", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const openNoteComposerTab = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-note-composer"]');
  await page.waitForSelector('[data-testid="settings-extract-replacement"]', { timeout: 3000 });
};
const setMode = async (mode) => {
  await openNoteComposerTab();
  await page.selectOption('[data-testid="settings-extract-replacement"]', mode);
  await wait(60);
  await app(() => window.__app.workspace.closeModal());
  await wait(60);
};

// run a real extract with the current setting; return the source doc after replacement
const extractAndReadSource = async (mode) => {
  await app(async (m) => {
    const W = window.__app;
    const path = `ex_${m}.md`;
    try { await W.vault.create(path, `before WORD${m} after`); } catch {}
    W.workspace.openFile(path, { focus: true });
    const tab = W.workspace.getActiveTab();
    W.workspace.setTabMode(tab.id, "source");
  }, mode);
  await page.waitForSelector(".cm-content", { timeout: 4000 });
  await page.click(".cm-content");
  await page.waitForFunction(() => !!window.__app.documents.getActiveView()?.view, null, { timeout: 4000 });
  await app((m) => {
    const v = window.__app.documents.getActiveView().view;
    const word = `WORD${m}`;
    const i = v.state.doc.toString().indexOf(word);
    v.dispatch({ selection: { anchor: i, head: i + word.length } });
    v.focus();
  }, mode);
  await wait(40);
  await app(() => window.geode.app.commands.execute("editor:extract-selection"));
  await wait(150); // extract awaits vault.create (async) before splicing the source
  return app(() => window.__app.documents.getActiveView().view.state.doc.toString());
};

console.log("— there is a Note composer settings nav entry with the Replace-selection dropdown —");
await openNoteComposerTab();
ok("Note composer section opens with the dropdown", await app(() => !!document.querySelector('[data-testid="settings-extract-replacement"]')));
ok("dropdown defaults to 'link'", (await app(() => document.querySelector('[data-testid="settings-extract-replacement"]')?.value)) === "link");
ok("dropdown offers exactly link / embed / none", await app(() => {
  const opts = [...document.querySelectorAll('[data-testid="settings-extract-replacement"] option')].map((o) => o.value);
  return opts.length === 3 && opts.includes("link") && opts.includes("embed") && opts.includes("none");
}));
ok("nav label is the native string 'Note composer'", (await app(() => document.querySelector('[data-testid="settings-nav-note-composer"]')?.textContent?.trim())) === "Note composer");
await app(() => window.__app.workspace.closeModal());
await wait(50);

console.log("— pure helper: replacement(name, mode) covers link / embed / none —");
ok("helper link → [[n]]", (await app(() => window.__geodeComposer.replacement("n", "link"))) === "[[n]]");
ok("helper embed → ![[n]]", (await app(() => window.__geodeComposer.replacement("n", "embed"))) === "![[n]]");
ok("helper none → '' (empty)", (await app(() => window.__geodeComposer.replacement("n", "none"))) === "");

console.log("— default (link): extracting leaves a [[wikilink]] in the source —");
ok("link mode: source has [[WORDlink]] and no embed", await (async () => {
  const doc = await extractAndReadSource("link");
  return doc.includes("[[WORDlink]]") && !doc.includes("![[");
})());

console.log("— embed: extracting leaves an ![[embed]] in the source —");
await setMode("embed");
ok("the dropdown persisted to localStorage as 'embed'", (await app(() => localStorage.getItem("geode.extractReplaceMode"))) === "embed");
ok("embed mode: source has ![[WORDembed]]", await (async () => {
  const doc = await extractAndReadSource("embed");
  return doc.includes("![[WORDembed]]");
})());

console.log("— none: extracting leaves NOTHING (selection removed, no reference) —");
await setMode("none");
ok("none mode: source keeps no reference to the extracted note", await (async () => {
  const doc = await extractAndReadSource("none");
  return !doc.includes("WORDnone") && !doc.includes("[[") && doc.includes("before") && doc.includes("after");
})());
// the extracted note still exists (extract = move, not delete)
ok("none mode: the extracted note was still created", await app(() => window.__app.vault.getFiles().some((f) => f.path.startsWith("WORDnone"))));

console.log("— the setting persists across reload —");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r234b", name: "r234b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await openNoteComposerTab();
ok("after reload the dropdown restores 'none'", (await app(() => document.querySelector('[data-testid="settings-extract-replacement"]')?.value)) === "none");
await app(() => window.__app.workspace.closeModal());

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR234 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
