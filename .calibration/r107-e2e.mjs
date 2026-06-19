/**
 * R107 wikilink [[note# heading completion E2E — browser mode :1420.
 * Run: node .calibration/r107-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 107 additions" (㊹ 续).
 *
 * `[[<note>#<query>` completes the resolved note's headings (insert `[[note#Heading]]`);
 * `[[#…` targets the current file (self-link). Headings whose text would break `[[…#…]]`
 * (`[ ] | #`) are skipped. Pure resolver = wikilinkHeadingTargets; CM popup is browser-only.
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r107", name: "r107", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeHeadingComplete, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hc = (typed, fromPath) => app(([t, f]) => window.__geodeHeadingComplete(t, f), [typed, fromPath]);

// a note with headings — including two that must be FILTERED ( ] and # break the link)
await app(async () => {
  try { await window.__app.vault.create("ZZHead.md", "# Intro\n\n## Setup\n\n### Details\n\n## Bad]Head\n\n## C# Notes\n"); } catch { /* exists */ }
  try { await window.__app.vault.create("ZZSrc.md", "# Source\n\nbody\n"); } catch { /* exists */ }
  await new Promise((r) => setTimeout(r, 250));
});

// ── wikilinkHeadingTargets (probe) ──────────────────────────────────────────
console.log("— wikilinkHeadingTargets (probe) —");
ok("`[[ZZHead#` → the note's safe headings (Bad]Head + C# Notes filtered)", eq(await hc("ZZHead#", "ZZSrc.md"), ["Intro", "Setup", "Details"]), JSON.stringify(await hc("ZZHead#", "ZZSrc.md")));
ok("`[[ZZHead#Set` → still returns all headings (CM filters by query)", eq(await hc("ZZHead#Set", "ZZSrc.md"), ["Intro", "Setup", "Details"]));
ok("`[[#` (empty note) → the CURRENT file's headings (self-link)", eq(await hc("#", "ZZHead.md"), ["Intro", "Setup", "Details"]), JSON.stringify(await hc("#", "ZZHead.md")));
ok("`[[ZZSrc` (no #) → null (file/alias completion, not heading)", (await hc("ZZSrc", "ZZSrc.md")) === null);
ok("`[[Nonexistent#` (unresolvable note) → null", (await hc("Nonexistent#", "ZZSrc.md")) === null);
ok("`[[#` with no active file → null (no self-target)", (await hc("#", null)) === null);

// ── [[note# CM completion: offer + insert [[note#Heading]] ──────────────────
console.log("— [[note# CM completion —");
await app(async () => {
  window.__app.workspace.openFile("ZZSrc.md");
  await new Promise((r) => setTimeout(r, 200));
  const tab = window.__app.workspace.getActiveTab();
  if (tab) window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
});
await page.waitForSelector(".cm-content", { timeout: 4000 });
await page.click(".cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n[[ZZHead#");
await wait(350);
ok("typing `[[ZZHead#` opens the autocomplete tooltip", await page.isVisible(".cm-tooltip-autocomplete"));
const opts = await page.$$eval(".cm-tooltip-autocomplete li", (els) => els.map((e) => e.textContent)).catch(() => []);
ok("the note's headings are offered (Setup present)", opts.some((o) => o && o.includes("Setup")), JSON.stringify(opts));
ok("the unsafe headings are NOT offered (Bad]Head filtered)", !opts.some((o) => o && o.includes("Bad]Head")), JSON.stringify(opts));
// narrow to Setup and accept
await page.keyboard.type("Set");
await wait(250);
await page.keyboard.press("Enter");
await wait(250);
const docText = await app(() => window.__app.documents.get(window.__app.workspace.getActiveFile())?.getText() ?? "");
ok("picking a heading inserts `[[ZZHead#Setup]]`", docText.includes("[[ZZHead#Setup]]"), JSON.stringify(docText.slice(-40)));

// ── [[# self-link completes the CURRENT note's headings ─────────────────────
console.log("— [[# self-link —");
await app(async () => {
  window.__app.workspace.openFile("ZZHead.md");
  await new Promise((r) => setTimeout(r, 200));
  const tab = window.__app.workspace.getActiveTab();
  if (tab) window.__app.workspace.setTabMode(tab.id, "live");
  await new Promise((r) => setTimeout(r, 250));
});
await page.click(".cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n[[#");
await wait(350);
ok("typing `[[#` in a note opens the autocomplete with its own headings", await app(() => {
  const lis = [...document.querySelectorAll(".cm-tooltip-autocomplete li")].map((e) => e.textContent);
  return lis.some((o) => o && o.includes("Intro")) && lis.some((o) => o && o.includes("Details"));
}));

// ── zero regression: plain `[[` file completion still works ─────────────────
console.log("— zero regression: plain [[ file completion —");
await page.keyboard.press("Control+End");
await page.keyboard.type("\n[[ZZSr");
await wait(300);
const fileOpts = await page.$$eval(".cm-tooltip-autocomplete li", (els) => els.map((e) => e.textContent)).catch(() => []);
ok("plain `[[ZZSr` still completes file basenames (ZZSrc)", fileOpts.some((o) => o && o.includes("ZZSrc")), JSON.stringify(fileOpts));

console.log(`\nR107 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
