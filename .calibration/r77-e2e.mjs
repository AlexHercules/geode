/**
 * R77 block-id mint E2E — browser mode (Memory vault) against dev :1420.
 * Run: node .calibration/r77-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 77 additions" (㊴).
 *
 * Covers blockRefAt (via __geodeBlockRef): paragraph mint / existing reuse /
 * blank / code-fence / frontmatter → null — AND the "Copy link to block" command:
 * mints `^id` into the doc, copies `[[note#^id]]`, and is idempotent.
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
await page.evaluate(() => {
  window.geode.registerPlugin({ id: "r77", name: "r77", onload(app) { window.__app = app; } });
  // capture clipboard writes (headless has no real clipboard)
  window.__clip = [];
  navigator.clipboard.writeText = (t) => { window.__clip.push(t); return Promise.resolve(); };
});
await page.waitForFunction(() => !!window.__app && !!window.__geodeBlockRef, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 30));
}, [p, c]);
const blockRef = (path, off) => app(([p, o]) => window.__geodeBlockRef(p, o), [path, off]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await create("para.md", "first paragraph here\n\nsecond block\n");
await create("hasid.md", "already tagged ^abc123\n");
await create("blank.md", "text\n\n\nmore\n");
await create("fence.md", "```js\nconst a = 1;\n```\n");
await create("fm.md", "---\ntitle: T\n---\n\nbody para\n");
await wait(300);

// ── blockRefAt logic (via probe hook) ───────────────────────────────────────
console.log("— blockRefAt —");
const r1 = await blockRef("para.md", 3); // inside "first paragraph here"
ok("paragraph → mints id + edit at line end", r1 && r1.edit && /^[a-z0-9]{6}$/.test(r1.id) && r1.edit.insert === " ^" + r1.id, JSON.stringify(r1));
ok("edit inserts at end of the block's last line (offset 20)", r1 && r1.edit.from === 20 && r1.edit.to === 20, JSON.stringify(r1 && r1.edit));
const r2 = await blockRef("hasid.md", 3); // block already has ^abc123
ok("existing id → reuse, edit null", r2 && r2.id === "abc123" && r2.edit === null, JSON.stringify(r2));
const r3 = await blockRef("blank.md", 5); // offset 5 = blank line between text and more
ok("blank line → null", r3 === null, JSON.stringify(r3));
const r4 = await blockRef("fence.md", 12); // inside the code fence
ok("inside code fence → null", r4 === null, JSON.stringify(r4));
const r5 = await blockRef("fm.md", 4); // inside frontmatter
ok("inside frontmatter → null", r5 === null, JSON.stringify(r5));

// ── command: mint into the doc + clipboard ──────────────────────────────────
console.log("— copy-block-link command —");
await app(async () => {
  window.__clip.length = 0;
  window.__app.workspace.openFile("para.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "source");
  await new Promise((r) => setTimeout(r, 350));
  window.__app.commands.execute("editor:copy-block-link");
  await new Promise((r) => setTimeout(r, 150));
});
const doc1 = await app(() => window.__app.documents.get("para.md")?.getText());
const mintedId = (doc1.match(/first paragraph here \^([a-z0-9]{6})/) || [])[1];
ok("command minted ^id into the first block", !!mintedId, JSON.stringify(doc1));
const clip1 = await app(() => window.__clip[window.__clip.length - 1]);
ok("clipboard got [[para#^id]]", clip1 === `[[para#^${mintedId}]]`, JSON.stringify(clip1));

// ── idempotent: running again reuses the same id ────────────────────────────
console.log("— idempotent —");
await app(async () => {
  window.__app.commands.execute("editor:copy-block-link");
  await new Promise((r) => setTimeout(r, 150));
});
const doc2 = await app(() => window.__app.documents.get("para.md")?.getText());
ok("second run does NOT add a second id (idempotent)", (doc2.match(/\^[a-z0-9]{6}/g) || []).length === 1, JSON.stringify(doc2));
const clip2 = await app(() => window.__clip[window.__clip.length - 1]);
ok("second run copies the same link", clip2 === `[[para#^${mintedId}]]`, JSON.stringify(clip2));

// ── embed variant ───────────────────────────────────────────────────────────
console.log("— copy-block-embed command —");
await app(async () => {
  window.__clip.length = 0;
  window.__app.commands.execute("editor:copy-block-embed");
  await new Promise((r) => setTimeout(r, 150));
});
const clipE = await app(() => window.__clip[window.__clip.length - 1]);
ok("embed command copies ![[para#^id]]", clipE === `![[para#^${mintedId}]]`, JSON.stringify(clipE));

// ── review MAJOR fix: route through formatLink (resolve-back + unsafe guard) ──
// a filename with a wikilink-unsafe char (`#`/`]`/`|`/`^`) can't form a safe
// [[..]] — the old hardcoded `[[name#^id]]` produced a broken link; formatLink
// returns null → no broken link is copied (the id is still minted, though).
console.log("— unsafe filename → no broken link copied —");
await create("weird#name.md", "tricky block here\n");
await wait(200);
await app(async () => {
  window.__clip.length = 0;
  window.__app.workspace.openFile("weird#name.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "source");
  await new Promise((r) => setTimeout(r, 350));
  window.__app.commands.execute("editor:copy-block-link");
  await new Promise((r) => setTimeout(r, 150));
});
const wDoc = await app(() => window.__app.documents.get("weird#name.md")?.getText());
ok("unsafe filename → id STILL minted into the doc", /tricky block here \^[a-z0-9]{6}/.test(wDoc), JSON.stringify(wDoc));
ok("unsafe filename → NO broken link copied (formatLink null → clipboard untouched)", await app(() => window.__clip.length === 0));

// ── shortest, unique basename → bare [[note#^id]] (formatLink honors setting) ─
console.log("— unique basename → shortest link —");
await app(async () => {
  window.__clip.length = 0;
  window.__app.workspace.openFile("para.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "source");
  await new Promise((r) => setTimeout(r, 300));
  window.__app.commands.execute("editor:copy-block-link");
  await new Promise((r) => setTimeout(r, 150));
});
const uClip = await app(() => window.__clip[window.__clip.length - 1]);
ok("unique basename → [[para#^id]] (shortest, resolve-back verified)", uClip === `[[para#^${mintedId}]]`, JSON.stringify(uClip));

console.log(`\nR77 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); }
await browser.close();
process.exit(failed ? 1 : 0);
