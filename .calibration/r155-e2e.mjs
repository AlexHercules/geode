/**
 * R155 "Detect all file extensions" E2E — browser mode :1420.
 * Run: node .calibration/r155-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 155 additions".
 *
 * Obsidian's "Detect all file extensions" (default OFF) shows every file's extension in the
 * explorer, including the .md on notes. Geode already renders non-md extensions as a
 * .explorer-ext badge; R155 relaxes the gate so .md notes show their badge too when ON.
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
await page.evaluate(() => { try { localStorage.removeItem("geode.detectAllExtensions"); localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r155", name: "r155", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const seed = async () => {
  await app(async () => {
    try { await window.__app.vault.create("r155-note.md", "# note\n"); } catch {}
    try { await window.__app.vault.createBinary("r155-pic.png", new Uint8Array([1, 2, 3, 4])); } catch {}
  });
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid=explorer-item][data-path="r155-note.md"]')
       && !!document.querySelector('[data-testid=explorer-item][data-path="r155-pic.png"]'),
    null, { timeout: 5000 },
  );
};
// the extension badge text for a given file row, or null if no badge
const extBadge = (path) => app((p) => {
  const row = document.querySelector(`[data-testid=explorer-item][data-path="${p}"]`);
  const ext = row?.querySelector("[data-testid=explorer-ext]");
  return ext ? ext.textContent.trim() : null;
}, path);
const toggleSetting = async () => {
  await app(() => window.__app.workspace.openModal("settings"));
  await page.click('[data-testid="settings-nav-files-and-links"]');
  await new Promise((r) => setTimeout(r, 80));
  await page.waitForSelector("[data-testid=settings-detect-extensions-toggle]", { timeout: 3000 });
  await page.click("[data-testid=settings-detect-extensions-toggle]");
  await wait(60);
  await app(() => window.__app.workspace.closeModal());
  await wait(60);
};

await seed();

console.log("— default OFF: .md hides extension, attachments still show theirs —");
ok("default OFF: .md note row has no extension badge", (await extBadge("r155-note.md")) === null);
ok("default OFF: .png attachment row shows 'png' badge", (await extBadge("r155-pic.png")) === "png");

console.log("— toggle ON: .md note now shows its extension too —");
await toggleSetting();
await wait(80);
ok("ON: .md note row now shows 'md' badge", (await extBadge("r155-note.md")) === "md");
ok("ON: .png attachment row still shows 'png' badge", (await extBadge("r155-pic.png")) === "png");
ok("the toggle reads on (aria-checked true)", await app(async () => {
  window.__app.workspace.openModal("settings");
  await new Promise((r) => setTimeout(r, 80));
  document.querySelector('[data-testid="settings-nav-files-and-links"]')?.click();
  await new Promise((r) => setTimeout(r, 80));
  const v = document.querySelector("[data-testid=settings-detect-extensions-toggle]")?.getAttribute("aria-checked");
  window.__app.workspace.closeModal();
  return v;
}) === "true");
ok("the pref persisted to localStorage as 'true'", (await app(() => localStorage.getItem("geode.detectAllExtensions"))) === "true");

console.log("— toggle OFF again: .md hides its extension —");
await toggleSetting();
await wait(80);
ok("OFF: .md note row hides its extension badge again", (await extBadge("r155-note.md")) === null);
ok("OFF: .png attachment row still shows 'png' badge", (await extBadge("r155-pic.png")) === "png");
ok("the pref persisted to localStorage as 'false'", (await app(() => localStorage.getItem("geode.detectAllExtensions"))) === "false");

console.log("— the pref survives a reload (persisted) —");
await toggleSetting(); // ON again, then reload
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r155b", name: "r155b", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });
await seed(); // memory vault resets on reload — recreate the files
ok("after reload the ON pref is honored (.md shows 'md' badge)", (await extBadge("r155-note.md")) === "md");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR155 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
