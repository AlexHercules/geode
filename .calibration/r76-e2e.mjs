/**
 * R76 custom task-state rendering E2E — browser mode against dev :1420.
 * Run: node .calibration/r76-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 76 additions" (㊳).
 *
 * Reading view renders non-standard checkbox markers (`[/] [-] [>] [<] …`) as
 * checkboxes carrying `data-task="<char>"` on the <li>, while standard `[ ]`/`[x]`
 * stay byte-identical (no data-task) and only `x`/`X` are done. Negative cases
 * (multi-char, empty, non-list) must NOT become checkboxes.
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
await page.waitForFunction(() => !!window.geode && !!window.__geodeRenderMarkdown, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r76", name: "r76", onload(app) { window.__app = app; } }));

const render = (src) => page.evaluate(([s]) => window.__geodeRenderMarkdown(s, ""), [src]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// the <li ...> open tag for the first task item (attributes we assert on)
const liTag = (html) => (html.match(/<li[^>]*class="task-list-item[^>]*>/) || [""])[0];

// ── custom states → data-task on the <li>, checkbox present, not done ────────
console.log("— custom states —");
const prog = await render("- [/] doing");
ok("[/] → checkbox present", /<input type="checkbox" class="task-checkbox"/.test(prog), prog);
ok("[/] → li carries data-task=\"/\"", /data-task="\/"/.test(prog), liTag(prog));
ok("[/] → NOT done (no is-checked, input not checked)", !/is-checked/.test(prog) && !/task-checkbox[^>]*checked/.test(prog), prog);

const cancel = await render("- [-] cancelled");
ok("[-] → data-task=\"-\"", /data-task="-"/.test(cancel), liTag(cancel));

const defer = await render("- [>] later");
ok("[>] → data-task=\"&gt;\" (escaped)", /data-task="&gt;"/.test(defer), liTag(defer));

const plan = await render("- [<] planned");
ok("[<] → data-task=\"&lt;\" (escaped)", /data-task="&lt;"/.test(plan), liTag(plan));

// ── standard states unchanged: no data-task, x/X done ───────────────────────
console.log("— standard states (byte-stable) —");
const todo = await render("- [ ] todo");
ok("[ ] → checkbox, task-list-item, NO data-task", /task-checkbox/.test(todo) && /task-list-item/.test(todo) && !/data-task/.test(todo), todo);
ok("[ ] → not checked", !/is-checked/.test(todo) && !/checkbox"[^>]*checked/.test(todo), todo);

const done = await render("- [x] done");
ok("[x] → checked + is-checked, NO data-task", /checkbox" data-line="\d+" checked>/.test(done) && /is-checked/.test(done) && !/data-task/.test(done), done);

const doneUpper = await render("- [X] done");
ok("[X] → checked (x/X both done), NO data-task", /checked>/.test(doneUpper) && /is-checked/.test(doneUpper) && !/data-task/.test(doneUpper), doneUpper);

// ── negative cases: NOT tasks ───────────────────────────────────────────────
console.log("— negatives —");
const multi = await render("- [ab] not a task");
ok("[ab] (multi-char) → NOT a checkbox", !/task-checkbox/.test(multi) && !/data-task/.test(multi), multi);

const empty = await render("- [] empty");
ok("[] (empty) → NOT a checkbox", !/task-checkbox/.test(empty), empty);

const inline = await render("this has [/] inline, not a list");
ok("non-list [/] → NOT a checkbox", !/task-checkbox/.test(inline) && !/data-task/.test(inline), inline);

const noSpace = await render("- [/]nospace");
ok("[/] without trailing space → NOT a checkbox (TASK_RE needs \\s+)", !/task-checkbox/.test(noSpace), noSpace);

// ── reading-view click toggle of a CUSTOM state (review MAJOR fix) ──────────
// R76 makes [/] a real checkbox → clicking it must toggle the source (the
// toggle path widened from ( |x|X) to [^\]]). Custom/non-done → done (x).
console.log("— click toggle (custom state) —");
await page.evaluate(async () => {
  try { await window.__app.vault.create("tt.md", "- [/] doing\n- [x] done\n"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 50));
  window.__app.workspace.openFile("tt.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "preview");
  await new Promise((r) => setTimeout(r, 350));
});
const customBox = await page.$('.editor-preview input.task-checkbox[data-line="0"]');
ok("custom-state checkbox rendered in preview", customBox !== null);
if (customBox) {
  await customBox.click();
  await wait(250);
  const after = await page.evaluate(() => window.__app.vault.read("tt.md"));
  ok("clicking [/] checkbox toggles source to [x] (was a dead click before)", after.startsWith("- [x] doing"), JSON.stringify(after));
}
// and a standard done checkbox still untoggles to [ ]
const doneBox = await page.$('.editor-preview input.task-checkbox[data-line="1"]');
if (doneBox) {
  await doneBox.click();
  await wait(250);
  const after2 = await page.evaluate(() => window.__app.vault.read("tt.md"));
  ok("clicking [x] still untoggles to [ ] (standard unchanged)", after2.includes("- [ ] done"), JSON.stringify(after2));
}

console.log(`\nR76 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
