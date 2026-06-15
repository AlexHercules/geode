/**
 * R83 Properties enhancement E2E — browser mode :1420.
 * Run: node .calibration/r83-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 83 additions" (㊼).
 *
 * Covers ㊼ tags-chip click → search (#tag) + keyboard navigation between
 * property rows (rows tabIndex=-1: ↑/↓ move rows, Enter focuses value editor,
 * Escape backs a field out to its row). View-only (no .md writes here).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r83", name: "r83", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const create = (p, c = "") => app(async ([path, content]) => {
  try { await window.__app.vault.create(path, content); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 50));
}, [p, c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// a note whose frontmatter has tags + a couple of scalar props (≥3 rows for nav)
await create("Props.md", "---\ntags:\n  - alpha\n  - beta\ntitle: Hello\ncount: 3\n---\n# Props\n");
await app(async () => {
  window.__app.workspace.openFile("Props.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 350));
});
await page.waitForSelector('[data-testid="properties-panel"]', { timeout: 4000 }).catch(() => {});
ok("properties panel visible (live)", await page.isVisible('[data-testid="properties-panel"]'));

// ── tags chip → search ──────────────────────────────────────────────────────
console.log("— tags chip click → search —");
ok("tags chip rendered as clickable search button",
  (await app(() => !!document.querySelector('[data-testid="property-chip-search-tags-0"]'))));
ok("non-tags scalar value is NOT a chip-search button",
  (await app(() => !document.querySelector('[data-testid="property-chip-search-title-0"]'))));
// click the first tag chip → opens left search panel, which consumes the
// request into its input (one-time-consume store, like revealTarget).
await page.click('[data-testid="property-chip-search-tags-0"]');
await wait(200);
ok("clicking the tag opens the left search panel",
  (await app(() => window.__app.workspace.state.get().leftPanel)) === "search");
await page.waitForSelector('[data-testid="search-input"]', { timeout: 3000 }).catch(() => {});
ok("search input seeded with #alpha",
  (await app(() => document.querySelector('[data-testid="search-input"]')?.value)) === "#alpha");
// second chip → #beta (panel already open; store re-consumed into the input)
await page.click('[data-testid="property-chip-search-tags-1"]');
await wait(200);
ok("second tag seeds the search input with #beta",
  (await app(() => document.querySelector('[data-testid="search-input"]')?.value)) === "#beta");

// ── keyboard navigation ─────────────────────────────────────────────────────
console.log("— keyboard navigation between rows —");
const rowCount = await app(() => document.querySelectorAll('[data-testid="properties-panel"] [data-prop-row]').length);
ok("at least 3 property rows", rowCount >= 3, String(rowCount));
// rows are a Tab stop (tabIndex=0); ↑/↓ navigate, Enter focuses value editor
const navResult = await app(async () => {
  const rows = [...document.querySelectorAll('[data-testid="properties-panel"] [data-prop-row]')];
  const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  rows[0].focus();
  const onFirst = document.activeElement === rows[0];
  key(rows[0], "ArrowDown");
  await new Promise((r) => setTimeout(r, 20));
  const movedDown = document.activeElement === rows[1];
  key(rows[1], "ArrowUp");
  await new Promise((r) => setTimeout(r, 20));
  const movedUp = document.activeElement === rows[0];
  // Enter on a row focuses its value editor (an input inside .property-value)
  key(rows[0], "Enter");
  await new Promise((r) => setTimeout(r, 20));
  const ae = document.activeElement;
  const enteredValue = !!ae && !!ae.closest(".property-value") && (ae.tagName === "INPUT" || ae.tagName === "SELECT");
  return { onFirst, movedDown, movedUp, enteredValue };
});
ok("first row focusable (Tab stop)", navResult.onFirst);
ok("ArrowDown moves focus to next row", navResult.movedDown);
ok("ArrowUp moves focus to previous row", navResult.movedUp);
ok("Enter focuses the row's value editor", navResult.enteredValue);

// ── data-safety: editing a field then Escape DISCARDS, never writes (reviewer CRITICAL) ──
console.log("— Escape discards, never writes frontmatter —");
const docBefore = await app(() => window.__app.documents.get("Props.md")?.getText() ?? "");
ok("frontmatter starts with count: 3", /count:\s*3/.test(docBefore), docBefore);
// edit the count value to 39, then press Escape (must discard, not commit)
await page.focus('[data-testid="property-value-count"]');
await page.fill('[data-testid="property-value-count"]', "39");
await page.press('[data-testid="property-value-count"]', "Escape");
await wait(150);
const countVal = await app(() => document.querySelector('[data-testid="property-value-count"]')?.value);
ok("Escape reverts the value editor to the stored value (3)", countVal === "3", countVal);
const docAfter = await app(() => window.__app.documents.get("Props.md")?.getText() ?? "");
ok("Escape did NOT write the edited value to frontmatter (still count: 3)",
  /count:\s*3/.test(docAfter) && !/count:\s*39/.test(docAfter), docAfter);

// arrows inside an input must NOT navigate rows (cursor stays in the field)
const inInputResult = await app(async () => {
  const rows = [...document.querySelectorAll('[data-testid="properties-panel"] [data-prop-row]')];
  const input = rows[0].querySelector(".property-value input, .property-value select");
  if (!input) return false;
  input.focus();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  return document.activeElement === input; // still in the field, did NOT jump to a row
});
ok("ArrowDown inside a field does not navigate rows", inInputResult);

console.log(`\nR83 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
