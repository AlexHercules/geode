/**
 * R235 Note composer "Ask to confirm before merging" toggle E2E — browser mode :1420.
 * Run: node .calibration/r235-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 235 additions".
 *
 * Obsidian's Note composer asks to confirm before merging (default ON). Geode gates the
 * QuickSwitcher merge path on the mergeConfirm Store: ON → a confirm dialog precedes the
 * (vetted) mergeNotes call; cancelling leaves the source untouched. OFF → merge immediately.
 * This suite drives real UI merges and toggles the browser confirm between accept/dismiss.
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
// the merge confirm is a window.confirm dialog — drive accept/dismiss + count via these.
let dialogMode = "accept";
let dialogsSeen = 0;
page.on("dialog", (d) => { dialogsSeen++; void (dialogMode === "accept" ? d.accept() : d.dismiss()); });

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.removeItem("geode.mergeConfirm"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r235", name: "r235", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => app((x) => window.__app.vault.read(x).catch(() => null), p);
const exists = (p) => app((x) => window.__app.vault.fileExists(x), p);

// drive a real UI merge: open source, run the merge command, pick the target in the switcher
const mergeViaUI = async (source, target, body) => {
  await app(async (a) => {
    await window.__app.vault.create(a.source, `# ${a.source}\n${a.body}SRC\n`).catch(() => {});
    await window.__app.vault.create(a.target, `# ${a.target}\n${a.body}TGT\n`).catch(() => {});
  }, { source, target, body });
  await wait(120);
  await app((s) => window.__app.workspace.openFile(s), source);
  await wait(120);
  await app(() => window.__app.commands.execute("editor:merge-file"));
  await wait(150);
  await page.fill("[data-testid=switcher-input]", target.replace(".md", ""));
  await wait(220);
  await page.locator("[data-testid=switcher-input]").press("Enter");
  await wait(450);
};

const openTab = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-note-composer"]');
  await page.waitForSelector('[data-testid="settings-merge-confirm-toggle"]', { timeout: 3000 });
};

console.log("— Note composer tab has a 'Ask to confirm before merging' toggle, default ON —");
await openTab();
ok("merge-confirm toggle present", await app(() => !!document.querySelector('[data-testid="settings-merge-confirm-toggle"]')));
ok("merge-confirm defaults ON", (await app(() => document.querySelector('[data-testid="settings-merge-confirm-toggle"]')?.getAttribute("aria-checked"))) === "true");
await app(() => window.__app.workspace.closeModal());
await wait(50);

console.log("— default ON + user confirms → the merge proceeds —");
dialogMode = "accept"; dialogsSeen = 0;
await mergeViaUI("AskSrc.md", "AskTgt.md", "ask");
ok("a confirm dialog was shown", dialogsSeen === 1, `dialogs=${dialogsSeen}`);
ok("confirmed merge trashes the source", !(await exists("AskSrc.md")));
const askTgt = await read("AskTgt.md");
ok("confirmed merge appends into target", !!askTgt && askTgt.includes("askTGT") && askTgt.includes("askSRC"), JSON.stringify(askTgt));

console.log("— default ON + user cancels → NO merge, source untouched —");
dialogMode = "dismiss"; dialogsSeen = 0;
await mergeViaUI("KeepSrc.md", "KeepTgt.md", "keep");
ok("a confirm dialog was shown", dialogsSeen === 1, `dialogs=${dialogsSeen}`);
ok("cancelled merge leaves the source in place (no data moved)", await exists("KeepSrc.md"));
const keepTgt = await read("KeepTgt.md");
ok("cancelled merge does NOT append into target", !!keepTgt && !keepTgt.includes("keepSRC"), JSON.stringify(keepTgt));

console.log("— toggle OFF → merge immediately, no dialog —");
await openTab();
await page.click('[data-testid="settings-merge-confirm-toggle"]');
await wait(60);
ok("toggle persisted OFF to localStorage", (await app(() => localStorage.getItem("geode.mergeConfirm"))) === "false");
await app(() => window.__app.workspace.closeModal());
await wait(50);
dialogMode = "accept"; dialogsSeen = 0;
await mergeViaUI("FastSrc.md", "FastTgt.md", "fast");
ok("OFF: NO confirm dialog appears", dialogsSeen === 0, `dialogs=${dialogsSeen}`);
ok("OFF: merge still trashes the source", !(await exists("FastSrc.md")));
const fastTgt = await read("FastTgt.md");
ok("OFF: merge appends into target", !!fastTgt && fastTgt.includes("fastTGT") && fastTgt.includes("fastSRC"), JSON.stringify(fastTgt));

console.log("— the OFF pref survives a reload —");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r235b", name: "r235b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await openTab();
ok("after reload the toggle restores OFF", (await app(() => document.querySelector('[data-testid="settings-merge-confirm-toggle"]')?.getAttribute("aria-checked"))) === "false");
await app(() => window.__app.workspace.closeModal());

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR235 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
