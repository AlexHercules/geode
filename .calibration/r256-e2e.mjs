/**
 * R256 view-header "…" more-options menu E2E — browser mode :1420.
 * Run: node .calibration/r256-e2e.mjs   (dev server must be up)
 *
 * Obsidian native per-view "More options" (…) menu at the right edge of the tab bar.
 * Aggregates view-mode toggle + file actions + tab/pane ops for the active tab, all
 * wired to EXISTING vetted commands (mirrors R252 editor menu; no new write path).
 * 机械档 scoped checks: button present, menu opens with the expected items, desktop-only
 * items (reveal/open-in-default) hidden in the browser (available() gate), representative
 * executes work (pin, toggle-mode), delete is danger-styled, the menu is DISTINCT from the
 * tab right-click context menu, and it dismisses.
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
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r256", name: "r256", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (sel) => app((s) => !!document.querySelector(s), sel);
const activeTab = () => app(() => { const t = window.__app.workspace.getActiveTab(); return t ? { id: t.id, mode: t.mode, pinned: t.pinned === true, viewType: t.viewType } : null; });

// setup: a markdown note open in the active leaf
await app(async () => {
  await window.__app.vault.create("more.md", "# More\nbody\n").catch(() => {});
  window.__app.workspace.openFile("more.md");
});
await page.waitForFunction(() => !!window.__app.workspace.getActiveFile(), null, { timeout: 5000 });
await wait(150);

console.log("— the view-header «…» more-options button is present —");
ok("more-options button present", await has(".tab-more-options"));
ok("button uses more-vertical glyph (no fallback crash)", (await app(() => document.querySelectorAll(".tab-more-options svg").length)) >= 1);

console.log("— clicking «…» opens the view-options menu (distinct testid) —");
await page.click(".tab-more-options");
await wait(120);
ok("view-options-menu opened", await has('[data-testid="view-options-menu"]'));
ok("it is NOT the tab-context-menu", !(await has('[data-testid="tab-context-menu"]')));

console.log("— menu aggregates the faithful item set for a markdown view —");
for (const [id, label] of [
  ["viewopt-toggle-mode", "view-mode toggle"],
  ["viewopt-bookmark", "bookmark"],
  ["viewopt-add-property", "add property"],
  ["viewopt-export-pdf", "export pdf"],
  ["viewopt-copy-path", "copy path"],
  ["viewopt-copy-url", "copy url"],
  ["viewopt-reveal-nav", "reveal in navigation (cross-platform)"],
  ["viewopt-rename", "rename"],
  ["viewopt-delete", "delete"],
  ["viewopt-pin", "pin"],
  ["viewopt-split-right", "split right"],
  ["viewopt-split-down", "split down"],
  ["viewopt-close", "close"],
  ["viewopt-close-others", "close others"],
]) ok(`item present: ${label}`, await has(`[data-testid="${id}"]`));

console.log("— desktop-only items hidden in the browser (available() gate, mirrors R252) —");
ok("reveal-in-system hidden in browser", !(await has('[data-testid="viewopt-reveal"]')));
ok("open-in-default-app hidden in browser", !(await has('[data-testid="viewopt-open-default"]')));

console.log("— delete item is danger-styled (--danger) —");
ok("delete has is-danger class", await app(() => document.querySelector('[data-testid="viewopt-delete"]')?.classList.contains("is-danger")));

console.log("— item labels come from the live command names (not raw keys) —");
ok("toggle-mode label resolved (non-empty, no dotted key)", await app(() => {
  const txt = document.querySelector('[data-testid="viewopt-toggle-mode"]')?.textContent ?? "";
  return txt.length > 0 && !txt.includes(".") ;
}));

console.log("— representative execute: pin toggles the active tab + label flips on reopen —");
const before = await activeTab();
await page.click('[data-testid="viewopt-pin"]');
await wait(120);
ok("menu dismissed after action", !(await has('[data-testid="view-options-menu"]')));
ok("pin executed: active tab now pinned", (await activeTab())?.pinned === true && before?.pinned === false);
await page.click(".tab-more-options");
await wait(120);
ok("pin label flipped to Unpin on reopen", await app(() => {
  const txt = document.querySelector('[data-testid="viewopt-pin"]')?.textContent?.toLowerCase() ?? "";
  return txt.includes("unpin");
}));
// unpin to restore
await page.click('[data-testid="viewopt-pin"]');
await wait(100);

console.log("— representative execute: toggle reading/edit mode —");
const m0 = (await activeTab())?.mode;
await page.click(".tab-more-options");
await wait(100);
await page.click('[data-testid="viewopt-toggle-mode"]');
await wait(150);
ok("toggle-mode executed: active tab mode changed", (await activeTab())?.mode !== m0, `${m0} -> ${(await activeTab())?.mode}`);

console.log("— the tab right-click context menu still works and is distinct —");
await app(() => {
  const tab = document.querySelector('.tab-bar .tab');
  const r = tab.getBoundingClientRect();
  tab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
});
await wait(120);
ok("right-click opens tab-context-menu (kind=tab)", await has('[data-testid="tab-context-menu"]'));
ok("view-options-menu not shown for right-click", !(await has('[data-testid="view-options-menu"]')));
// dismiss
await page.keyboard.press("Escape");
await wait(80);
ok("Escape dismisses the menu", !(await has('[data-testid="tab-context-menu"]')));

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR256 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
