/**
 * R86 File properties pane + delete-property E2E — browser mode :1420.
 * Run: node .calibration/r86-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 86 additions" (㊼).
 *
 * Covers ㊼ fileproperties right-sidebar tab + reusing PropertiesPanel as a SECOND
 * writer of the active doc (acquire handle + applyExternalEdits, coexisting with a
 * live CM view) + Cmd/Ctrl+Backspace deleting the focused property. Writes .md (DS).
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r86", name: "r86", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 50));
}, [p, c]);
const docText = (p) => app(([path]) => window.__app.documents.get(path)?.getText() ?? "(not open)", [p]);

await create("Fp.md", "---\ntags:\n  - a\ntitle: Hello\ncount: 3\n---\n# Fp\n");
await create("Fp2.md", "---\nauthor: Ada\n---\n# Fp2\n");

// open Fp.md in LIVE mode → a CM view is attached (tests second-writer coexistence)
await app(async () => {
  window.__app.workspace.openFile("Fp.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 300));
});

// ── the fileproperties right tab ────────────────────────────────────────────
console.log("— fileproperties tab —");
ok("right-tab-fileproperties present", await app(() => !!document.querySelector('[data-testid="right-tab-fileproperties"]')));
await page.click('[data-testid="right-tab-fileproperties"]');
await page.waitForSelector('[data-testid="fileproperties-panel"]', { timeout: 4000 }).catch(() => {});
ok("clicking the tab shows the file-properties panel", await app(() => !!document.querySelector('[data-testid="fileproperties-panel"]')));
ok("panel reuses PropertiesPanel (rows for the active file)", await app(() =>
  !!document.querySelector('[data-testid="fileproperties-panel"] [data-testid="property-row-title"]') &&
  !!document.querySelector('[data-testid="fileproperties-panel"] [data-testid="property-row-count"]')));

// ── second-writer edit reaches the live doc (no mismatch crash) ─────────────
console.log("— edit via the right panel writes the active doc —");
await page.fill('[data-testid="fileproperties-panel"] [data-testid="property-value-count"]', "42");
await page.press('[data-testid="fileproperties-panel"] [data-testid="property-value-count"]', "Enter");
await wait(200);
ok("editing count in the panel updates the live document buffer", /count:\s*42/.test(await docText("Fp.md")), await docText("Fp.md"));

// ── Cmd/Ctrl+Backspace deletes the focused property ─────────────────────────
console.log("— Cmd+Backspace deletes a property —");
const before = await docText("Fp.md");
ok("title property present before delete", /title:\s*Hello/.test(before), before);
const delResult = await app(async () => {
  const row = document.querySelector('[data-testid="fileproperties-panel"] [data-testid="property-row-title"]');
  if (!row) return "no-row";
  row.focus();
  const onRow = document.activeElement === row;
  row.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", metaKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 50));
  return onRow ? "ok" : "not-focused";
});
ok("row focusable for keyboard delete", delResult === "ok", delResult);
await wait(200);
const after = await docText("Fp.md");
ok("Cmd+Backspace removed the title property from the doc", !/title:\s*Hello/.test(after), after);
ok("Cmd+Backspace left the other properties intact (count, tags)", /count:/.test(after) && /tags:/.test(after), after);

// ── plain Backspace on a row must NOT delete (only Cmd/Ctrl) ────────────────
const beforePlain = await docText("Fp.md");
await app(async () => {
  const row = document.querySelector('[data-testid="fileproperties-panel"] [data-testid="property-row-count"]');
  row?.focus();
  row?.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 50));
});
await wait(120);
ok("plain Backspace (no modifier) does NOT delete the property", (await docText("Fp.md")) === beforePlain);

// ── switching active file re-targets the panel ──────────────────────────────
console.log("— panel follows the active file —");
await app(async () => { window.__app.workspace.openFile("Fp2.md"); await new Promise((r) => setTimeout(r, 350)); });
ok("panel now shows Fp2's properties (author)", await app(() =>
  !!document.querySelector('[data-testid="fileproperties-panel"] [data-testid="property-row-author"]')));
ok("panel no longer shows Fp's count property", await app(() =>
  !document.querySelector('[data-testid="fileproperties-panel"] [data-testid="property-row-count"]')));

console.log(`\nR86 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
