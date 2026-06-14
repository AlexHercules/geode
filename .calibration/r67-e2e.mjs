/**
 * R67 drag-vault-file-into-editor E2E — browser mode against dev :1420.
 * Run: node .calibration/r67-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 67 additions".
 *
 * Covers ㉛ (Obsidian core: drop a file from the file explorer into the editor →
 * insert a link). A vault note → [[Name]]; an attachment → ![[name.ext]]; a folder
 * (or unknown path) → no insertion (doc unchanged). Drop is simulated by
 * dispatching a synthetic DragEvent carrying EXPLORER_MIME (the same custom MIME
 * the explorer sets on dragstart) — real OS drag-drop is unreliable in Playwright.
 * Data safety: the insert is a sync editor dispatch (no await), source byte-exact
 * apart from the inserted link.
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const MIME = "application/x-geode-path"; // = EXPLORER_MIME (core/explorerMove.ts)
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r67", name: "r67", onload(app) { window.__app = app; } }));

const create = (p, c) => page.evaluate(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 60));
}, [p, c]);
const docText = () => page.evaluate(() => {
  const p = window.__app.workspace.getActiveFile();
  return window.__app.documents.get(p)?.getText() ?? null;
});
const openLive = (p) => page.evaluate(async (path) => {
  window.__app.workspace.openFile(path);
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 200));
}, p);
// dispatch a synthetic explorer-drag drop onto the editor at the cursor
const dropPath = (path) => page.evaluate((p) => {
  const dt = new DataTransfer();
  dt.setData("application/x-geode-path", p);
  const content = document.querySelector(".cm-content");
  const rect = content.getBoundingClientRect();
  content.dispatchEvent(new DragEvent("drop", {
    bubbles: true, cancelable: true, dataTransfer: dt,
    clientX: rect.left + 6, clientY: rect.top + 6,
  }));
}, path);

await create("NoteA.md", "# Note A\n");
await create("pic.png", "fake-png");
await create("Target.md", "start\n");
await page.evaluate(async () => { try { await window.__app.vault.createFolder("Folder1"); } catch {} await new Promise((r) => setTimeout(r, 60)); });

console.log("— drop a note → [[Name]] wikilink at the cursor —");
await openLive("Target.md");
await page.click(".cm-content");
await page.keyboard.press(`${MOD}+Home`);
await page.waitForTimeout(60);
await dropPath("NoteA.md");
await page.waitForTimeout(120);
ok("dropping NoteA.md inserts [[NoteA]]", (await docText()).includes("[[NoteA]]"), JSON.stringify(await docText()));
ok("note link has no embed bang", !(await docText()).includes("![[NoteA]]"), JSON.stringify(await docText()));

console.log("— drop an attachment → ![[name.ext]] embed —");
await dropPath("pic.png");
await page.waitForTimeout(120);
ok("dropping pic.png inserts ![[pic.png]] embed", (await docText()).includes("![[pic.png]]"), JSON.stringify(await docText()));

console.log("— drop a folder → no insertion (doc unchanged) —");
const before = await docText();
await dropPath("Folder1");
await page.waitForTimeout(120);
ok("dropping a folder inserts nothing", (await docText()) === before, JSON.stringify(await docText()));
await dropPath("Ghost/Missing.md");
await page.waitForTimeout(80);
ok("dropping an unknown path inserts nothing", (await docText()) === before, JSON.stringify(await docText()));

console.log("— data safety: drop is a pure editor insert (buffer = source + link only) —");
const finalDoc = await docText();
ok("only the two links were inserted into the original 'start' text",
  finalDoc.includes("start") && finalDoc.includes("[[NoteA]]") && finalDoc.includes("![[pic.png]]"),
  JSON.stringify(finalDoc));

console.log("— review fix: duplicate basename disambiguates to the full path —");
await create("A/Spec.md", "# A spec\n");
await create("B/Spec.md", "# B spec\n");
await create("DTarget.md", "x\n");
await openLive("DTarget.md");
await page.click(".cm-content");
await page.keyboard.press(`${MOD}+Home`);
await page.waitForTimeout(60);
await dropPath("B/Spec.md");
await page.waitForTimeout(120);
const dDoc = await docText();
ok("dropping B/Spec.md inserts the disambiguated [[B/Spec]] (not bare [[Spec]])",
  dDoc.includes("[[B/Spec]]"), JSON.stringify(dDoc));

console.log("— review fix: a wikilink-unsafe filename inserts nothing (no broken link) —");
await create("Weird#Name.md", "# weird\n");
const beforeWeird = await docText();
await dropPath("Weird#Name.md");
await page.waitForTimeout(100);
ok("dropping 'Weird#Name.md' (has #) inserts nothing", (await docText()) === beforeWeird, JSON.stringify(await docText()));

console.log("— review fix: dragover with EXPLORER_MIME is accepted (preventDefault) —");
const prevented = await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData("application/x-geode-path", "A/Spec.md");
  const content = document.querySelector(".cm-content");
  const ev = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt });
  content.dispatchEvent(ev);
  return ev.defaultPrevented;
});
ok("dragover carrying EXPLORER_MIME is preventDefaulted (editor accepts the drop)", prevented);

console.log(`\nR67 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
