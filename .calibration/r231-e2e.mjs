/**
 * R231 Quick switcher 3-setting tab E2E — browser mode :1420.
 * Run: node .calibration/r231-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 231 additions".
 *
 * Obsidian's Quick switcher settings: Show existing only / Show attachments (default ON) /
 * Show all file types. Geode gates the switcher file list (md → +attachments → all) + the
 * create-new row on persisted Stores. Pure read-only nav; no .md writes.
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
await page.evaluate(() => { try { ["geode.switcherShowExistingOnly","geode.switcherShowAttachments","geode.switcherShowAllTypes"].forEach((k)=>localStorage.removeItem(k)); localStorage.setItem("geode.locale","en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r231", name: "r231", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await app(async () => {
  try { await window.__app.vault.create("alpha.md", "# alpha\n"); } catch {}
  try { await window.__app.vault.create("picimg.png", "binary-ish"); } catch {}
  try { await window.__app.vault.create("zdatafile.txt", "plain text\n"); } catch {}
  try { await window.__app.vault.create("exactmatch.png", "img"); } catch {} // attachment, NO same-named note
});
await page.waitForFunction(() => window.__app.vault.getFiles().some((f) => f.path === "picimg.png"), null, { timeout: 4000 });

const openSwitcher = async () => { await app(() => window.__app.workspace.openModal("switcher")); await page.waitForSelector("[data-testid=switcher-input]", { timeout: 4000 }); };
const closeModal = async () => { await app(() => window.__app.workspace.closeModal()); await wait(70); };
const query = async (q) => { await page.fill("[data-testid=switcher-input]", q); await wait(140); };
const fileRows = () => app(() => [...document.querySelectorAll("[data-testid=switcher-item] .palette-item-name")].map((e) => e.textContent.trim().toLowerCase()));
const hasCreate = () => app(() => !!document.querySelector(".palette-create"));
const toggle = async (testid) => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-quick-switcher"]');
  await wait(90);
  await page.click(`[data-testid="${testid}"]`);
  await wait(70);
  await closeModal();
};

console.log("— there is a Quick switcher settings nav entry —");
await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-quick-switcher"]');
ok("Quick switcher settings section opens (3 toggles)", await app(() => !!document.querySelector('[data-testid="settings-switcher-existing-only"]') && !!document.querySelector('[data-testid="settings-switcher-attachments"]') && !!document.querySelector('[data-testid="settings-switcher-all-types"]')));
ok("'Show attachments' defaults ON", (await app(() => document.querySelector('[data-testid="settings-switcher-attachments"]')?.getAttribute("aria-checked"))) === "true");
await closeModal();

console.log("— defaults: notes + attachments shown, all-types hidden, create row shown —");
await openSwitcher();
await query("picimg");
ok("default ON: an attachment (picimg.png) appears", (await fileRows()).some((n) => n.includes("picimg")), JSON.stringify(await fileRows()));
await query("zdatafile");
ok("default OFF all-types: a .txt (editable non-md) does NOT appear", !(await fileRows()).some((n) => n.includes("zdatafile")), JSON.stringify(await fileRows()));
await query("novelqueryxyz");
ok("default: a 'create new note' row appears for a novel query", await hasCreate());
// review-caught: an attachment basename exact-match must NOT suppress the create row
// (the create row makes a .md note; exactmatch.png exists but exactmatch.md does not)
await query("exactmatch");
ok("attachment exact-name match still shows the create-note row (create makes a .md note)", await hasCreate());
await closeModal();

console.log("— 'Show existing only' suppresses the create row —");
await toggle("settings-switcher-existing-only");
await openSwitcher();
await query("novelqueryxyz");
ok("existing-only ON: NO create row", !(await hasCreate()));
await closeModal();

console.log("— 'Show attachments' OFF removes attachments —");
await toggle("settings-switcher-attachments");
await openSwitcher();
await query("picimg");
ok("attachments OFF: picimg.png NO longer appears", !(await fileRows()).some((n) => n.includes("picimg")), JSON.stringify(await fileRows()));
await query("alpha");
ok("attachments OFF: a .md note still appears", (await fileRows()).some((n) => n.includes("alpha")), JSON.stringify(await fileRows()));
await closeModal();

console.log("— 'Show all file types' includes editable non-md files —");
await toggle("settings-switcher-all-types");
await openSwitcher();
await query("zdatafile");
ok("all-types ON: zdatafile.txt now appears", (await fileRows()).some((n) => n.includes("zdatafile")), JSON.stringify(await fileRows()));
await closeModal();

console.log("— the settings persist across reload —");
ok("localStorage persisted the 3 toggles", await app(() => localStorage.getItem("geode.switcherShowExistingOnly") === "true" && localStorage.getItem("geode.switcherShowAttachments") === "false" && localStorage.getItem("geode.switcherShowAllTypes") === "true"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r231b", name: "r231b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await app(() => window.__app.workspace.openModal("settings"));
await page.click('[data-testid="settings-nav-quick-switcher"]');
await wait(80);
ok("after reload, existing-only restored ON", (await app(() => document.querySelector('[data-testid="settings-switcher-existing-only"]')?.getAttribute("aria-checked"))) === "true");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR231 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
