/**
 * R92 tab indent size + indent-using-tabs E2E — browser mode :1420.
 * Run: node .calibration/r92-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 92 additions" (㊶ 续续).
 *
 * Proves the FULL chain: setting → reactive CM compartment reconfigure →
 * indentUnit facet → indentWithTab → the characters Tab actually inserts.
 * Pure front-end, no .md byte suite (markdown.ts untouched). The only writes are
 * the Tab presses themselves, through the normal CM edit path (data-safety: the
 * insert is exactly the unit and nothing else).
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
// clean slate for the indent prefs so we observe the Obsidian defaults
await page.evaluate(() => {
  localStorage.setItem("geode.locale", "en");
  localStorage.removeItem("geode.tabIndentSize");
  localStorage.removeItem("geode.indentUsingTabs");
});
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r92", name: "r92", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeIndentConfig, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 50));
}, [p, c]);
const ls = (k) => app(([key]) => localStorage.getItem(key), [k]);
const tabSizeFacet = () => app(() => window.__app.documents.getActiveView()?.view.state.tabSize);

// open a note in live mode (a CM view exists)
await create("ind.md", "# t\n\nx\n");
await app(async () => {
  window.__app.workspace.openFile("ind.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 300));
});
await page.locator('[data-testid="cm-editor"] .cm-content').click().catch(() => {});
await wait(80);

/** Reset the doc to "# t\n\nx\n", park the cursor at the empty line 2, focus,
 *  press a real Tab key, and return the resulting document text. */
async function tabInsert() {
  await app(async () => {
    const view = window.__app.documents.getActiveView()?.view;
    if (!view) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "# t\n\nx\n" } });
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
    view.focus();
  });
  await wait(60);
  await page.keyboard.press("Tab");
  await wait(80);
  return app(() => window.__app.documents.getActiveView()?.view.state.doc.toString());
}

// ── pure derivation + clamp (probe) ─────────────────────────────────────────
console.log("— unit derivation + clamp —");
ok("tabs-on → unit is a tab char", (await app(() => window.__geodeIndentConfig(4, true))).unit === "\t");
ok("tabs-off size 4 → unit is 4 spaces", (await app(() => window.__geodeIndentConfig(4, false))).unit === "    ");
ok("tabs-off size 2 → unit is 2 spaces", (await app(() => window.__geodeIndentConfig(2, false))).unit === "  ");
ok("clamp: size 99 → 8", (await app(() => window.__geodeIndentConfig(99, false))).size === 8);
ok("clamp: size 0 → 1", (await app(() => window.__geodeIndentConfig(0, false))).size === 1);
ok("clamp: NaN → 4", (await app(() => window.__geodeIndentConfig(Number.NaN, true))).size === 4);

// ── live CM: the characters Tab actually inserts ────────────────────────────
console.log("— Tab insertion through the live editor —");
await app(() => window.__geodeIndentConfig(4, true));
await wait(120);
ok("default tabs-on: Tab inserts a tab char", (await tabInsert()) === "# t\n\t\nx\n");
ok("tabs-on: tabSize facet is 4", (await tabSizeFacet()) === 4);

await app(() => window.__geodeIndentConfig(4, false));
await wait(120);
ok("tabs-off size 4: Tab inserts 4 spaces", (await tabInsert()) === "# t\n    \nx\n");

await app(() => window.__geodeIndentConfig(2, false));
await wait(120);
ok("tabs-off size 2: Tab inserts 2 spaces", (await tabInsert()) === "# t\n  \nx\n");
ok("size 2: tabSize facet is 2", (await tabSizeFacet()) === 2);

await app(() => window.__geodeIndentConfig(8, true));
await wait(120);
ok("size 8 tabs-on: Tab still inserts a tab char", (await tabInsert()) === "# t\n\t\nx\n");
ok("size 8: tabSize facet is 8 (tab renders 8-wide)", (await tabSizeFacet()) === 8);

// ── persistence ─────────────────────────────────────────────────────────────
console.log("— persistence —");
ok("tab size persists to localStorage", (await ls("geode.tabIndentSize")) === "8");
ok("indent-using-tabs persists (true)", (await ls("geode.indentUsingTabs")) === "true");
await app(() => window.__geodeIndentConfig(2, false));
await wait(60);
ok("indent-using-tabs persists (false)", (await ls("geode.indentUsingTabs")) === "false");

// ── settings UI ─────────────────────────────────────────────────────────────
console.log("— settings UI —");
await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 250)); });
ok("indent-using-tabs toggle present", await app(() => !!document.querySelector('[data-testid="settings-indent-tabs-toggle"]')));
ok("tab-size segmented present (2/4/8)", await app(() =>
  !!document.querySelector('[data-testid="settings-tabsize-2"]') &&
  !!document.querySelector('[data-testid="settings-tabsize-4"]') &&
  !!document.querySelector('[data-testid="settings-tabsize-8"]')));
await page.click('[data-testid="settings-indent-tabs-toggle"]');
await wait(100);
ok("toggle flips indent-using-tabs to true via UI", (await ls("geode.indentUsingTabs")) === "true");
await page.click('[data-testid="settings-tabsize-4"]');
await wait(100);
ok("segmented sets tab size to 4 via UI", (await ls("geode.tabIndentSize")) === "4");
await app(() => window.__app.workspace.closeModal());
await wait(150);
// after the UI flip (tabs-on, size 4) the live editor follows reactively
ok("UI change reaches the live editor: Tab inserts a tab char", (await tabInsert()) === "# t\n\t\nx\n");

console.log(`\nR92 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
