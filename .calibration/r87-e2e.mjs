/**
 * R87 strict line breaks E2E — browser mode :1420.
 * Run: node .calibration/r87-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 87 additions" (㊶).
 *
 * Covers the markdown-it `breaks` flip (single newline → <br> by default,
 * matching Obsidian; strict ON = CommonMark join) via __geodeRenderMarkdown +
 * the settings toggle reactively re-rendering the reading view + persistence.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r87", name: "r87", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeRenderMarkdown, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const render = (src, strict) => app(([s, st]) => window.__geodeRenderMarkdown(s, "", st), [src, strict]);
const ls = (k) => app(([key]) => localStorage.getItem(key), [k]);

// ── markdown-it breaks flip (truth table) ───────────────────────────────────
console.log("— breaks flip —");
const soft = "line one\nline two";
ok("default (strict OFF) → single newline renders <br> (Obsidian default)",
  (await render(soft, false)).includes("<br>"), await render(soft, false));
ok("strict ON → single newline joins (no <br>, CommonMark)",
  !(await render(soft, true)).includes("<br>"), await render(soft, true));
// two trailing spaces → <br> in BOTH modes (hard break)
ok("two trailing spaces → <br> even in strict mode",
  (await render("a  \nb", true)).includes("<br>"));
// blank-line paragraphs are unaffected by the setting
const para = "para one\n\npara two";
ok("blank-line paragraphs unaffected (default) — two <p>, no <br>",
  (await render(para, false)).match(/<p>/g)?.length === 2 && !(await render(para, false)).includes("<br>"));
ok("blank-line paragraphs unaffected (strict) — two <p>, no <br>",
  (await render(para, true)).match(/<p>/g)?.length === 2 && !(await render(para, true)).includes("<br>"));

// ── settings toggle reactively re-renders the reading view ──────────────────
console.log("— settings toggle + reactive reading view —");
await app(async ([s]) => {
  try { await window.__app.vault.create("slb.md", s); } catch { /* exists */ }
  window.__app.workspace.openFile("slb.md");
  const tab = window.__app.workspace.getActiveTab();
  window.__app.workspace.setTabMode(tab.id, "preview");
  await new Promise((r) => setTimeout(r, 300));
}, ["alpha\nbeta\n"]);
const previewHasBr = () => app(() => !!document.querySelector('[data-testid="preview-content"] br, .preview-content br, .markdown-reading-view br'));
ok("reading view shows <br> by default (single newline)", await previewHasBr());

// open settings, toggle strict ON
await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 250)); });
await page.click('[data-testid="settings-nav-editor"]');
await new Promise((r) => setTimeout(r, 80));
ok("strict-line-breaks toggle present", await app(() => !!document.querySelector('[data-testid="settings-strict-linebreaks-toggle"]')));
await page.click('[data-testid="settings-strict-linebreaks-toggle"]');
await wait(120);
ok("toggle persists to localStorage (strict ON = true)", (await ls("geode.strictLineBreaks")) === "true");
// close settings, the preview should have reactively re-rendered without <br>
await app(() => window.__app.workspace.closeModal());
await wait(200);
ok("reading view re-renders WITHOUT <br> after enabling strict", !(await previewHasBr()));

// toggle back off → <br> returns
await app(async () => { window.__app.workspace.openModal("settings"); await new Promise((r) => setTimeout(r, 200)); });
await page.click('[data-testid="settings-nav-editor"]');
await new Promise((r) => setTimeout(r, 80));
await page.click('[data-testid="settings-strict-linebreaks-toggle"]');
await wait(120);
await app(() => window.__app.workspace.closeModal());
await wait(200);
ok("disabling strict restores <br> in the reading view", await previewHasBr());
ok("toggle off persists (false)", (await ls("geode.strictLineBreaks")) === "false");

console.log(`\nR87 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
