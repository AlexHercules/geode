/**
 * R161 — Tier 7 A1: "app:delete-file" delete-current-note command — browser :1420.
 * Run: node .calibration/r161-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 161 additions" (Tier 7 A1).
 *
 * Reuses the Explorer's vetted flush-before-trash path (recoverable .trash, R42),
 * markdown-only via workspace.getActiveFile(), confirm via shared @core/confirm.
 * MemoryVaultAdapter (browser) → create/trash are in-memory, safe.
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

// controllable confirm() handler (browser confirmDelete → window.confirm)
let dialogAction = "accept";
let dialogCount = 0;
let lastDialogMessage = "";
page.on("dialog", async (d) => {
  dialogCount++;
  lastDialogMessage = d.message();
  if (dialogAction === "accept") await d.accept();
  else await d.dismiss();
});

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r161", name: "r161", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fileExists = (p) => ev((path) => window.__app.vault.getFiles().some((f) => f.path === path), p);
const activeFile = () => ev(() => window.__app.workspace.getActiveFile());
const cmdAvailable = () => ev(() => {
  const c = window.__app.commands.list().find((x) => x.id === "app:delete-file");
  return c ? (c.available ? c.available() : true) : null;
});

// create + open a disposable test note
await ev(async () => { await window.__app.vault.create("r161-test.md", "hello r161"); window.__app.workspace.openFile("r161-test.md"); });
await wait(120);

console.log("— command registered + available gate (md file active) —");
ok("getActiveFile() === r161-test.md", (await activeFile()) === "r161-test.md");
ok("command app:delete-file is registered", await ev(() => window.__app.commands.list().some((c) => c.id === "app:delete-file")));
ok("available() === true when a markdown file is active", (await cmdAvailable()) === true);

console.log("— cancel (dismiss confirm) leaves the file + tab intact —");
dialogAction = "dismiss";
const beforeCancel = dialogCount;
await ev(() => window.__app.commands.execute("app:delete-file"));
await wait(250);
ok("confirm dialog was shown", dialogCount === beforeCancel + 1);
ok("dialog message names the file", lastDialogMessage.includes("r161-test.md"), `msg="${lastDialogMessage}"`);
ok("file still exists after cancel", await fileExists("r161-test.md"));
ok("tab still open after cancel (getActiveFile unchanged)", (await activeFile()) === "r161-test.md");

console.log("— accept (confirm) trashes the file (recoverable) + closes its tab —");
dialogAction = "accept";
const beforeAccept = dialogCount;
const trashBefore = await ev(async () => (await window.__app.vault.listTrash()).length);
await ev(() => window.__app.commands.execute("app:delete-file"));
await wait(300);
ok("confirm dialog was shown", dialogCount === beforeAccept + 1);
ok("file removed from vault after accept", !(await fileExists("r161-test.md")));
ok("active tab closed (getActiveFile no longer the deleted note)", (await activeFile()) !== "r161-test.md");
ok("file is recoverable in .trash (R42, not permanent delete)",
  (await ev(async () => (await window.__app.vault.listTrash()).length)) === trashBefore + 1);

console.log("— available gate false + callback self-guard when no markdown active —");
await ev(() => window.__app.workspace.openGraph()); // graph tab → getActiveFile null
await wait(120);
ok("getActiveFile() === null on graph tab", (await activeFile()) === null);
ok("available() === false with no markdown active", (await cmdAvailable()) === false);
const beforeGuard = dialogCount;
await ev(() => window.__app.commands.execute("app:delete-file")); // execute bypasses available → callback must self-guard
await wait(200);
ok("callback self-guards: no confirm dialog when getActiveFile() is null", dialogCount === beforeGuard);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR161: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
