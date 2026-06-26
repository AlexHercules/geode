/**
 * R252 (A2) editor right-click file-action items E2E — browser mode :1420.
 * Run: node .calibration/r252-e2e.mjs   Contract: docs/ARCHITECTURE.md "Round 252 additions".
 *
 * The editor context menu (compat/obsidian/editorMenu.ts) now adds reference-08 file-action items
 * after the native Cut/Copy/Paste — all pure wiring to EXISTING vetted commands. Asserts the items
 * appear with the commands' names, desktop-only items (reveal/open in default app) are hidden in the
 * browser (available()=false), the delete item routes to the vetted app:delete-file (deleteConfirm
 * dialog → recoverable trash), the bookmark label flips, and group separators have no dangling rule.
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
let dialogMode = "accept", dialogsSeen = 0;
page.on("dialog", (d) => { dialogsSeen++; void (dialogMode === "accept" ? d.accept() : d.dismiss()); });

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); localStorage.setItem("geode.deleteConfirm", "true"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r252", name: "r252", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app && !!window.app.workspace, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const cmdName = (id) => app((i) => { const c = window.__app.commands.list().find((x) => x.id === i); return c ? (typeof c.name === "function" ? c.name() : c.name) : null; }, id);
const menuLabels = () => page.$$eval('[data-testid="compat-menu-item"]', (els) => els.map((e) => e.textContent.trim()));
const sepCount = () => page.$$eval('[data-testid="compat-menu"] .menu-separator', (els) => els.length);
const ctxMenu = () => app(() => {
  const v = window.__app.documents.getActiveView().view;
  const r = v.contentDOM.getBoundingClientRect();
  v.contentDOM.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 8 }));
});
const clickItem = (label) => page.$$eval('[data-testid="compat-menu-item"]', (els, l) => { const it = els.find((e) => e.textContent.trim() === l); if (it) it.click(); }, label);
const closeMenu = async () => { await page.keyboard.press("Escape").catch(() => {}); await app(() => document.querySelector('[data-testid="compat-menu"]')?.remove()); };
const exists = (p) => app((x) => window.__app.vault.fileExists(x), p);
const openLive = async (path) => {
  await app(async (p) => { try { await window.__app.vault.create(p, "alpha beta gamma\n"); } catch {} window.__app.workspace.openFile(p); const tab = window.__app.workspace.getActiveTab(); window.__app.workspace.setTabMode(tab.id, "live"); }, path);
  await page.waitForFunction(() => !!window.__app.documents.getActiveView(), null, { timeout: 5000 });
  await wait(150);
};

await openLive("r252.md");

console.log("A. file-action items appear after the native clipboard items —");
await ctxMenu();
await page.waitForSelector('[data-testid="compat-menu"]', { timeout: 3000 });
const labels = await menuLabels();
ok("native Cut/Copy/Paste are first 3", labels[0] === "Cut" && labels[1] === "Copy" && labels[2] === "Paste", JSON.stringify(labels));
ok("the menu has file-action items after clipboard (>3 total)", labels.length > 3, JSON.stringify(labels));
const expectPresent = ["bookmarks:bookmark-file", "editor:add-property", "app:export-pdf", "file-explorer:copy-path", "workspace:copy-url", "workspace:edit-file-title", "app:delete-file"];
for (const id of expectPresent) {
  const nm = await cmdName(id);
  ok(`file-action present: ${id} ("${nm}")`, !!nm && labels.includes(nm), `${nm} :: ${JSON.stringify(labels)}`);
}

console.log("B. desktop-only items (reveal/open in default app) are HIDDEN in the browser (available()=false) —");
for (const id of ["file-explorer:reveal-in-system", "file-explorer:open-in-default-app"]) {
  const nm = await cmdName(id);
  ok(`desktop item hidden in browser: ${id}`, !!nm && !labels.includes(nm), `${nm} :: ${JSON.stringify(labels)}`);
}

console.log("C. delete item carries the warning style; separators have no dangling rule —");
const delName = await cmdName("app:delete-file");
const delWarn = await page.$$eval('[data-testid="compat-menu-item"]', (els, l) => { const it = els.find((e) => e.textContent.trim() === l); return it ? (it.className.includes("warning") || it.classList.contains("is-warning") || it.classList.contains("mod-warning")) : null; }, delName);
ok("delete item has a warning class (danger style)", delWarn === true, `class check for "${delName}"`);
// browser: clipboard group + file-group-1 + delete-group → 2 separators (desktop group hidden, no dangling)
ok("separators: one before each non-empty group, none dangling (2 in browser)", (await sepCount()) === 2, `sepCount=${await sepCount()}`);
await closeMenu();

console.log("D. clicking Delete routes to the vetted app:delete-file (deleteConfirm dialog → recoverable trash) —");
await openLive("r252-del.md");
ok("r252-del.md exists before delete", await exists("r252-del.md"));
await ctxMenu();
await page.waitForSelector('[data-testid="compat-menu"]', { timeout: 3000 });
dialogMode = "accept"; dialogsSeen = 0;
await clickItem(await cmdName("app:delete-file"));
await wait(350);
ok("Delete showed the deleteConfirm dialog (vetted path, not a new one)", dialogsSeen === 1, `dialogs=${dialogsSeen}`);
ok("Delete trashed the active file", !(await exists("r252-del.md")));
ok("the trashed file is recoverable in .trash (vetted trash, not permanent)", (await app(() => window.__app.vault.listTrash())).includes(".trash/r252-del.md"));

console.log("E. the bookmark item label flips after bookmarking (reuses the command's name thunk) —");
await openLive("r252-bm.md");
const bmBefore = await cmdName("bookmarks:bookmark-file");
await app(() => window.geode.app.commands.execute("bookmarks:bookmark-file"));
await wait(120);
const bmAfter = await cmdName("bookmarks:bookmark-file");
ok("bookmark command name flips bookmark→unbookmark", bmBefore !== bmAfter, `${bmBefore} → ${bmAfter}`);
await ctxMenu();
await page.waitForSelector('[data-testid="compat-menu"]', { timeout: 3000 });
ok("the editor menu shows the FLIPPED (unbookmark) label, not the stale one", (await menuLabels()).includes(bmAfter), `${bmAfter} :: ${JSON.stringify(await menuLabels())}`);
await app(() => window.geode.app.commands.execute("bookmarks:bookmark-file")); // restore
await closeMenu();

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR252 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
