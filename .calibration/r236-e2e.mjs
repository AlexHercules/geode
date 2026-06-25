/**
 * R236 Note composer "Template file location" E2E — browser mode :1420.
 * Run: node .calibration/r236-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 236 additions".
 *
 * Obsidian's Note composer applies a template when extracting a selection into a new note.
 * Geode threads extractTemplatePath through extractRange: default "" → verbatim (prior); a
 * configured template is read + expanded ({{content}}/{{fromTitle}}/{{newTitle}}/{{date}}),
 * single-pass so a replacement value containing "{{...}}" is never re-expanded. {{content}}
 * omitted → content appended. Unreadable template → verbatim fallback (no data loss).
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
await page.evaluate(() => { try { localStorage.removeItem("geode.extractTemplatePath"); localStorage.removeItem("geode.extractReplaceMode"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r236", name: "r236", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => app((x) => window.__app.vault.read(x).catch(() => null), p);

const openTab = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-note-composer"]');
  await page.waitForSelector('[data-testid="settings-extract-template"]', { timeout: 3000 });
};
const setTemplatePath = async (path) => {
  await openTab();
  await page.fill('[data-testid="settings-extract-template"]', path);
  await wait(60);
  await app(() => window.__app.workspace.closeModal());
  await wait(60);
};

// extract the WHOLE doc of a freshly-created source note; return the new note's content.
// (deriveNoteName uses the first line, so noteName = sanitized first line of docText.)
const extractWholeDoc = async (srcPath, docText, noteName) => {
  await app(async (a) => {
    const W = window.__app;
    try { await W.vault.create(a.srcPath, a.docText); } catch {}
    W.workspace.openFile(a.srcPath, { focus: true });
    const tab = W.workspace.getActiveTab();
    W.workspace.setTabMode(tab.id, "source");
  }, { srcPath, docText });
  await page.waitForSelector(".cm-content", { timeout: 4000 });
  await page.click(".cm-content");
  await page.waitForFunction(() => !!window.__app.documents.getActiveView()?.view, null, { timeout: 4000 });
  await app(() => {
    const v = window.__app.documents.getActiveView().view;
    v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } });
    v.focus();
  });
  await wait(40);
  await app(() => window.geode.app.commands.execute("editor:extract-selection"));
  await wait(200);
  return read(noteName);
};

console.log("— Note composer tab has a 'Template file location' input, default empty —");
await openTab();
ok("template-location input present", await app(() => !!document.querySelector('[data-testid="settings-extract-template"]')));
ok("template location defaults empty", (await app(() => document.querySelector('[data-testid="settings-extract-template"]')?.value)) === "");
await app(() => window.__app.workspace.closeModal());
await wait(50);

console.log("— default (no template): extract creates the note verbatim —");
const verb = await extractWholeDoc("vsrc.md", "verbnote\nplain body", "verbnote.md");
ok("verbatim note is just the extracted content", verb === "verbnote\nplain body\n", JSON.stringify(verb));

console.log("— with a template: variables expand into the new note —");
await app(() => window.__app.vault.create("tmpl.md", "FROM={{fromTitle}} NEW={{newTitle}} D={{date}}\n{{content}}\n").catch(() => {}));
await wait(80);
await setTemplatePath("tmpl.md");
const tpl = await extractWholeDoc("tsrc.md", "tnote\nthe body line", "tnote.md");
ok("{{fromTitle}} → source note name", !!tpl && tpl.includes("FROM=tsrc"), JSON.stringify(tpl));
ok("{{newTitle}} → new note name", !!tpl && tpl.includes("NEW=tnote"), JSON.stringify(tpl));
ok("{{date}} → formatted date (YYYY-MM-DD)", !!tpl && /D=\d{4}-\d{2}-\d{2}/.test(tpl), JSON.stringify(tpl));
ok("{{content}} → the extracted text", !!tpl && tpl.includes("tnote\nthe body line"), JSON.stringify(tpl));

console.log("— {{content}} omitted in the template → content appended at the bottom —");
await app(() => window.__app.vault.create("tmpl2.md", "# {{newTitle}}\nno content var here\n").catch(() => {}));
await wait(80);
await setTemplatePath("tmpl2.md");
const app2 = await extractWholeDoc("asrc.md", "anote\nappended body", "anote.md");
ok("template body present", !!app2 && app2.includes("no content var here"), JSON.stringify(app2));
ok("extracted content appended at the bottom", !!app2 && app2.includes("anote\nappended body") && app2.trimEnd().endsWith("appended body"), JSON.stringify(app2));

console.log("— {{CONTENT}} (uppercase) expands once, not duplicated (case-insensitive omit-check) —");
await app(() => window.__app.vault.create("tmpl3.md", "# {{newTitle}}\n{{CONTENT}}\n").catch(() => {}));
await wait(80);
await setTemplatePath("tmpl3.md");
const uc = await extractWholeDoc("ucsrc.md", "ucnote\nuc body", "ucnote.md");
ok("uppercase {{CONTENT}} substituted (not appended a 2nd time)", !!uc && (uc.match(/uc body/g) || []).length === 1, JSON.stringify(uc));

console.log("— adversarial: a literal {{fromTitle}} INSIDE the extracted content is NOT re-expanded —");
await setTemplatePath("tmpl.md"); // has {{content}} + a real {{fromTitle}}
const adv = await extractWholeDoc("advsrc.md", "advnote\nkeep {{fromTitle}} literal", "advnote.md");
ok("template's own {{fromTitle}} expanded to the source name", !!adv && adv.includes("FROM=advsrc"), JSON.stringify(adv));
ok("the literal {{fromTitle}} in the content stays verbatim (single-pass)", !!adv && adv.includes("keep {{fromTitle}} literal"), JSON.stringify(adv));

console.log("— unreadable template path → verbatim fallback (no data loss) —");
await setTemplatePath("does/not/exist.md");
const fb = await extractWholeDoc("fbsrc.md", "fbnote\nfallback body", "fbnote.md");
ok("missing template falls back to verbatim content", fb === "fbnote\nfallback body\n", JSON.stringify(fb));

console.log("— the template path persists across reload —");
await setTemplatePath("tmpl.md");
ok("template path persisted to localStorage", (await app(() => localStorage.getItem("geode.extractTemplatePath"))) === "tmpl.md");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r236b", name: "r236b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await openTab();
ok("after reload the template path is restored", (await app(() => document.querySelector('[data-testid="settings-extract-template"]')?.value)) === "tmpl.md");
await app(() => window.__app.workspace.closeModal());

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR236 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
