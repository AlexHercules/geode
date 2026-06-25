/**
 * R230 "Set as attachment folder" (folder right-click) E2E — browser mode :1420.
 * Run: node .calibration/r230-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 230 additions".
 *
 * Obsidian's folder context menu has "Set as attachment folder". Geode adds it to the Explorer
 * folder right-click, calling the vetted setAttachmentFolder (writes the geode.attachmentFolder
 * localStorage setting — where NEW attachments save). Non-data-safety: no file move/delete.
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
await page.evaluate(() => { try { localStorage.removeItem("geode.attachmentFolder"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r230", name: "r230", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const attachKey = () => app(() => localStorage.getItem("geode.attachmentFolder"));

await app(async () => {
  try { await window.__app.vault.createFolder("myassets"); } catch {}
  try { await window.__app.vault.create("loose.md", "# loose\n"); } catch {}
  window.__app.workspace.setLeftPanel("explorer");
});
await page.waitForSelector('[data-path="myassets"]', { timeout: 5000 });
await wait(120);

console.log("— folder right-click shows 'Set as attachment folder' and sets it —");
await page.click('[data-path="myassets"]', { button: "right" });
const saw = await page.waitForSelector('[data-testid="explorerctx-set-attachment-folder"]', { timeout: 3000 }).then(() => true).catch(() => false);
ok("folder context menu has the 'Set as attachment folder' item", saw);
await page.click('[data-testid="explorerctx-set-attachment-folder"]');
await wait(120);
ok("clicking it sets geode.attachmentFolder = 'myassets'", (await attachKey()) === "myassets", String(await attachKey()));
ok("a toast confirms the new attachment folder", await app(() => {
  const txt = document.querySelector(".link-update-notice")?.textContent ?? "";
  return /myassets/.test(txt);
}));
ok("the menu closes after clicking", await app(() => document.querySelector('[data-testid="explorer-menu"]') === null));

console.log("— a FILE right-click does NOT show the item (folder-only) —");
await page.click('[title="loose.md"]', { button: "right" });
await wait(120);
ok("file context menu has NO 'Set as attachment folder' item", await app(() => !document.querySelector('[data-testid="explorerctx-set-attachment-folder"]')));
await page.keyboard.press("Escape");

console.log("— the setting persists across reload —");
ok("localStorage persisted attachmentFolder='myassets'", (await attachKey()) === "myassets");
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
ok("after reload, attachmentFolder still 'myassets'", (await attachKey()) === "myassets", String(await attachKey()));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR230 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
