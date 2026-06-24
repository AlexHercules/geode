/**
 * R209 — G3 §2 missing→done: editor:attach-file (插入附件 / Insert attachment).
 * Picks a file via <input type=file>, imports it into the vault attachment folder
 * (R17 importAttachment/ingestFiles, reused), inserts `![[linktext]]` at the cursor.
 * Browser :1420.  Run: node .calibration/r209-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 209 additions".
 *
 * Drives the REAL command end-to-end via Playwright's filechooser (intercepts the
 * <input> picker). A = registration; C = full flow (pick → import → embed + vault
 * binary write); D = no-overwrite (second same-name file → uniquePath ` 1`).
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
// attachment folder = "" (vault root) → deterministic paths for the asserts
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); localStorage.setItem("geode.attachmentFolder", ""); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r209", name: "r209", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("A. command registration + no default hotkey");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "editor:attach-file");
  return { present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey("editor:attach-file") || null };
});
ok("editor:attach-file registered", reg.present);
ok("name resolves (not raw 'cmd.' key)", !!reg.name && !reg.name.startsWith("cmd."), String(reg.name));
ok("name is 'Insert attachment' (EN)", reg.name === "Insert attachment", String(reg.name));
ok("has NO default hotkey", reg.hotkey === null, String(reg.hotkey));

// open a note in live mode, cursor after "intro "
await app(async () => { try { await window.__app.vault.create("note.md", "intro \n"); } catch { /* exists */ } });
await app(() => {
  window.__app.workspace.openFile("note.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
});
await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
await wait(150);
await app(() => window.__app.documents.getActiveView().view.dispatch({ selection: { anchor: 6, head: 6 } }));

// drive editor:attach-file with a synthetic file via the filechooser
async function attachFile(name, bytes) {
  const chooserP = page.waitForEvent("filechooser", { timeout: 5000 });
  await app(() => window.__app.commands.execute("editor:attach-file"));
  const chooser = await chooserP;
  await chooser.setFiles({ name, mimeType: "image/png", buffer: Buffer.from(bytes) });
  await wait(250); // async import + insert
}

console.log("C. full flow: pick → import to vault → insert `![[]]` embed");
await attachFile("pic.png", [1, 2, 3, 4]);
let doc = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("embed `![[pic.png]]` inserted at the cursor (after 'intro ')", doc.startsWith("intro ![[pic.png]]"), JSON.stringify(doc));
const bin1 = await app(async () => Array.from(await window.__app.vault.readBinary("pic.png")));
ok("file written into the vault (binary bytes match)", JSON.stringify(bin1) === JSON.stringify([1, 2, 3, 4]), JSON.stringify(bin1));
const inputGone = await app(() => !document.querySelector('[data-testid="attach-file-input"]'));
ok("the transient <input> is removed after pick", inputGone);

console.log("D. no-overwrite: attaching the same name again → uniquePath ` 1`");
// move cursor to end of doc first
await app(() => { const v = window.__app.documents.getActiveView().view; v.dispatch({ selection: { anchor: v.state.doc.length } }); });
await attachFile("pic.png", [9, 9, 9]);
doc = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("second same-name file gets a unique linktext `![[pic 1.png]]`", doc.includes("![[pic 1.png]]"), JSON.stringify(doc));
const orig = await app(async () => Array.from(await window.__app.vault.readBinary("pic.png")));
ok("ORIGINAL pic.png NOT overwritten (still [1,2,3,4])", JSON.stringify(orig) === JSON.stringify([1, 2, 3, 4]), JSON.stringify(orig));
const bin2 = await app(async () => Array.from(await window.__app.vault.readBinary("pic 1.png")));
ok("new 'pic 1.png' has the second file's bytes [9,9,9]", JSON.stringify(bin2) === JSON.stringify([9, 9, 9]), JSON.stringify(bin2));

console.log("E. extensionless file keeps its name (R209-exposed fidelity fix — no synthetic .png)");
await app(() => { const v = window.__app.documents.getActiveView().view; v.dispatch({ selection: { anchor: v.state.doc.length } }); });
await attachFile("Makefile", [7, 7]);
doc = await app(() => window.__app.documents.getActiveView().view.state.doc.toString());
ok("extensionless 'Makefile' → `![[Makefile]]` (NOT Makefile.png)", doc.includes("![[Makefile]]") && !doc.includes("Makefile.png"), JSON.stringify(doc));
const mk = await app(async () => Array.from(await window.__app.vault.readBinary("Makefile")));
ok("vault file 'Makefile' (no extension) has the bytes [7,7]", JSON.stringify(mk) === JSON.stringify([7, 7]), JSON.stringify(mk));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR209: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
