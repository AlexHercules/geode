/**
 * R242 "Confirm file deletion" toggle E2E — browser mode :1420.
 * Run: node .calibration/r242-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 242 additions".
 *
 * Obsidian's Files&Links "Confirm file deletion". Geode gates the delete confirmation dialog on
 * the deleteConfirm Store (default ON = always confirm, a safety deviation from Obsidian's OFF;
 * deletes always go to the recoverable .trash). This drives app:delete-file with the browser
 * confirm toggled accept/dismiss and asserts the file is trashed / kept accordingly.
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
let dialogMode = "accept";
let dialogsSeen = 0;
page.on("dialog", (d) => { dialogsSeen++; void (dialogMode === "accept" ? d.accept() : d.dismiss()); });

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.removeItem("geode.deleteConfirm"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r242", name: "r242", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => app((x) => window.__app.vault.fileExists(x), p);

const deleteActiveFile = async (path) => {
  await app(async (p) => { try { await window.__app.vault.create(p, "# " + p + "\n"); } catch {} window.__app.workspace.openFile(p); }, path);
  await wait(100);
  await app(() => window.geode.app.commands.execute("app:delete-file"));
  await wait(300);
};

const openFilesTab = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-files-and-links"]');
  await page.waitForSelector('[data-testid="settings-delete-confirm-toggle"]', { timeout: 3000 });
};

console.log("— Files & Links has a 'Confirm file deletion' toggle, default ON —");
await openFilesTab();
ok("delete-confirm toggle present", await app(() => !!document.querySelector('[data-testid="settings-delete-confirm-toggle"]')));
ok("defaults ON (Geode safety deviation from Obsidian's OFF)", (await app(() => document.querySelector('[data-testid="settings-delete-confirm-toggle"]')?.getAttribute("aria-checked"))) === "true");
await app(() => window.__app.workspace.closeModal());
await wait(50);

console.log("— default ON + confirm → the file is deleted (trashed) —");
dialogMode = "accept"; dialogsSeen = 0;
await deleteActiveFile("DelAccept.md");
ok("a confirm dialog was shown", dialogsSeen === 1, `dialogs=${dialogsSeen}`);
ok("confirmed delete trashes the file", !(await exists("DelAccept.md")));

console.log("— default ON + cancel → the file is kept (no data lost) —");
dialogMode = "dismiss"; dialogsSeen = 0;
await deleteActiveFile("DelCancel.md");
ok("a confirm dialog was shown", dialogsSeen === 1, `dialogs=${dialogsSeen}`);
ok("cancelled delete keeps the file", await exists("DelCancel.md"));

console.log("— toggle OFF → delete with no confirm dialog (Obsidian-faithful, still → .trash) —");
await openFilesTab();
await page.click('[data-testid="settings-delete-confirm-toggle"]');
await wait(60);
ok("toggle persisted OFF to localStorage", (await app(() => localStorage.getItem("geode.deleteConfirm"))) === "false");
await app(() => window.__app.workspace.closeModal());
await wait(50);
dialogMode = "accept"; dialogsSeen = 0;
await deleteActiveFile("DelNoConfirm.md");
ok("OFF: NO confirm dialog appears", dialogsSeen === 0, `dialogs=${dialogsSeen}`);
ok("OFF: the file is still deleted (trashed)", !(await exists("DelNoConfirm.md")));

console.log("— the OFF pref survives a reload —");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r242b", name: "r242b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await openFilesTab();
ok("after reload the toggle restores OFF", (await app(() => document.querySelector('[data-testid="settings-delete-confirm-toggle"]')?.getAttribute("aria-checked"))) === "false");
await app(() => window.__app.workspace.closeModal());

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR242 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
