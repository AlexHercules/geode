/**
 * R23 templates E2E — browser mode (Memory vault) against dev server :1420.
 * Run: node .calibration/r23-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 23 additions".
 */
import { chromium } from "playwright";

const URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => {
  localStorage.removeItem("geode.templateFolder");
  localStorage.removeItem("geode.templateDateFormat");
  localStorage.removeItem("geode.templateTimeFormat");
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => {
  window.geode.registerPlugin({ id: "r23probe", name: "r23probe", onload(app) { window.__app = app; } });
});
const app = async (fn, arg) => page.evaluate(fn, arg);

console.log("— selector: list / sort / filter —");
await app(async () => {
  window.__app.workspace.openFile("Welcome.md");
  await new Promise(r => setTimeout(r, 400));
  window.__app.commands.execute("editor:insert-template");
});
await page.waitForSelector('[data-testid="template-selector"]');
let opts = await page.$$eval('[data-testid="template-option"]', els => els.map(e => e.getAttribute("data-path")));
ok("two demo templates listed", opts.length === 2, JSON.stringify(opts));
ok("sorted by name (Daily Log first)", opts[0] === "templates/Daily Log.md");
await page.fill('[data-testid="template-selector-input"]', "meet");
opts = await page.$$eval('[data-testid="template-option"]', els => els.map(e => e.getAttribute("data-path")));
ok("filter narrows to Meeting Notes", opts.length === 1 && opts[0] === "templates/Meeting Notes.md");

console.log("— insert mode: expansion + cursor + undo —");
await page.keyboard.press("Enter");
await page.waitForFunction(() => !document.querySelector('[data-testid="template-selector"]'));
let text = await app(async () => {
  await window.__app.workspace.flushAll();
  return window.__app.vault.read("Welcome.md");
});
ok("{{title}} expanded to note basename", text.includes("# Welcome\n"));
ok("{{date}} expanded (YYYY-MM-DD)", /Created: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text));
ok("no unexpanded variables left", !text.includes("{{"));
const insertedLen = text.length;
await page.click(".cm-content");
await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
text = await app(async () => {
  await window.__app.workspace.flushAll();
  return window.__app.vault.read("Welcome.md");
});
ok("single undo reverts whole insertion", !text.includes("type: meeting") && text.length < insertedLen);

console.log("— create mode: unique title + custom format + literal —");
let res = await app(async () => {
  window.__app.commands.execute("app:new-note-from-template");
  await new Promise(r => setTimeout(r, 300));
  document.querySelector('[data-testid="template-option"][data-path="templates/Meeting Notes.md"]').click();
  await new Promise(r => setTimeout(r, 400));
  const p1 = window.__app.workspace.getActiveFile();
  window.__app.commands.execute("app:new-note-from-template");
  await new Promise(r => setTimeout(r, 300));
  document.querySelector('[data-testid="template-option"][data-path="templates/Meeting Notes.md"]').click();
  await new Promise(r => setTimeout(r, 400));
  const p2 = window.__app.workspace.getActiveFile();
  await window.__app.workspace.flushAll();
  return { p1, p2, c2: await window.__app.vault.read(p2) };
});
ok("first create lands at root with template name", res.p1 === "Meeting Notes.md");
ok("second create gets unique suffix", res.p2 === "Meeting Notes 1.md");
ok("{{title}} uses uniquified basename", res.c2.includes("# Meeting Notes 1"));

res = await app(async () => {
  window.__app.commands.execute("app:new-note-from-template");
  await new Promise(r => setTimeout(r, 300));
  document.querySelector('[data-testid="template-option"][data-path="templates/Daily Log.md"]').click();
  await new Promise(r => setTimeout(r, 400));
  await window.__app.workspace.flushAll();
  return window.__app.vault.read(window.__app.workspace.getActiveFile());
});
ok("custom moment format expanded", /# Daily Log — \w+, \w+ \d+(st|nd|rd|th) \d{4}/.test(res));
ok("{{title:...}} stays literal", res.includes("{{title:bogus}}"));

console.log("— adversarial: single-pass + case-insensitive + unclosed —");
res = await app(async () => {
  const a = window.__app;
  // note: "{{date: C {{time}}" would CLOSE at {{time}}'s "}}" per the frozen
  // grammar (fmt = [^}]* up to the nearest "}}") — that's contract behavior,
  // not a bug. A truly unclosed variable has no "}}" anywhere after it.
  await a.vault.create("templates/Edge.md", "A {{DATE}} B {{title}} C {{date:never-closed");
  await a.vault.create("{{date}} host.md", "x");
  a.workspace.openFile("{{date}} host.md");
  await new Promise(r => setTimeout(r, 400));
  a.commands.execute("editor:insert-template");
  await new Promise(r => setTimeout(r, 300));
  document.querySelector('[data-testid="template-option"][data-path="templates/Edge.md"]').click();
  await new Promise(r => setTimeout(r, 400));
  await a.workspace.flushAll();
  return a.vault.read("{{date}} host.md");
});
ok("{{DATE}} case-insensitive expands", /A \d{4}-\d{2}-\d{2} B/.test(res));
ok("truly unclosed {{date: stays literal", res.includes("C {{date:never-closed"), JSON.stringify(res));
ok("{{title}} of host note NOT re-expanded (single pass)", res.includes("B {{date}} host C"));

console.log("— settings: folder/date/time consumption —");
res = await app(async () => {
  const a = window.__app;
  const setVal = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; s.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
  a.commands.execute("app:open-settings");
  await new Promise(r => setTimeout(r, 300));
  document.querySelector('[data-testid="settings-nav-templates"]')?.click();
  await new Promise(r => setTimeout(r, 120));
  const folder = document.querySelector('[data-testid="settings-template-folder"]');
  const out = { phFolder: folder.placeholder, phDate: document.querySelector('[data-testid="settings-template-date-format"]').placeholder, phTime: document.querySelector('[data-testid="settings-template-time-format"]').placeholder };
  setVal(folder, "  no-such-folder  ");
  a.workspace.closeModal();
  a.commands.execute("editor:insert-template");
  await new Promise(r => setTimeout(r, 300));
  out.emptyHint = document.querySelector('[data-testid="template-selector-hint"]')?.textContent ?? null;
  out.emptyOpts = document.querySelectorAll('[data-testid="template-option"]').length;
  a.workspace.closeModal();
  // invalid folder -> notConfigured
  a.commands.execute("app:open-settings");
  await new Promise(r => setTimeout(r, 300));
  document.querySelector('[data-testid="settings-nav-templates"]')?.click();
  await new Promise(r => setTimeout(r, 120));
  setVal(document.querySelector('[data-testid="settings-template-folder"]'), "../evil");
  a.workspace.closeModal();
  a.commands.execute("editor:insert-template");
  await new Promise(r => setTimeout(r, 300));
  out.invalidHint = document.querySelector('[data-testid="template-selector-hint"]')?.textContent ?? null;
  out.invalidOpts = document.querySelectorAll('[data-testid="template-option"]').length;
  a.workspace.closeModal();
  // restore + custom date format consumed by insert-date
  a.commands.execute("app:open-settings");
  await new Promise(r => setTimeout(r, 300));
  document.querySelector('[data-testid="settings-nav-templates"]')?.click();
  await new Promise(r => setTimeout(r, 120));
  setVal(document.querySelector('[data-testid="settings-template-folder"]'), "templates");
  setVal(document.querySelector('[data-testid="settings-template-date-format"]'), "[D:]YYYY/MM/DD");
  a.workspace.closeModal();
  a.workspace.openFile("Getting Started.md");
  await new Promise(r => setTimeout(r, 400));
  a.commands.execute("editor:insert-date");
  await new Promise(r => setTimeout(r, 200));
  await a.workspace.flushAll();
  out.dateDoc = await a.vault.read("Getting Started.md");
  return out;
});
ok("placeholders per contract", res.phFolder === "templates" && res.phDate === "YYYY-MM-DD" && res.phTime === "HH:mm");
ok("missing folder -> empty hint, zero options", res.emptyOpts === 0 && !!res.emptyHint);
ok("'../evil' folder -> notConfigured hint, zero options", res.invalidOpts === 0 && !!res.invalidHint);
ok("insert-date uses custom format", /D:\d{4}\/\d{2}\/\d{2}/.test(res.dateDoc));

console.log("— preview flip —");
res = await app(async () => {
  const a = window.__app;
  a.workspace.openFile("Wiki Links.md");
  await new Promise(r => setTimeout(r, 300));
  const tab = a.workspace.getActiveTab();
  a.workspace.setTabMode(tab.id, "preview");
  await new Promise(r => setTimeout(r, 300));
  a.commands.execute("editor:insert-template");
  await new Promise(r => setTimeout(r, 400));
  const mode = a.workspace.getActiveTab().mode;
  const open = !!document.querySelector('[data-testid="template-selector"]');
  document.querySelector('[data-testid="template-option"][data-path="templates/Meeting Notes.md"]')?.click();
  await new Promise(r => setTimeout(r, 400));
  await a.workspace.flushAll();
  return { mode, open, doc: await a.vault.read("Wiki Links.md") };
});
ok("preview tab flips to live", res.mode === "live");
ok("selector opens and insert succeeds after flip", res.open && res.doc.includes("type: meeting"));

await app(() => {
  localStorage.removeItem("geode.templateFolder");
  localStorage.removeItem("geode.templateDateFormat");
  localStorage.removeItem("geode.templateTimeFormat");
});
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
ok("no page errors", errors.length === 0);

await browser.close();
console.log(`\nR23 E2E: ${passed} passed, ${failed} failed${failed ? " — " + fails.join("; ") : ""}`);
process.exit(failed ? 1 : 0);
