/**
 * R162 regression — bookmark remains reachable from the Obsidian-style view menu.
 * Run: node .calibration/r162-e2e.mjs (dev server must be up).
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
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r162", name: "r162", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const openMenu = async () => {
  await page.click('[data-testid="editor-more-options"]');
  await page.waitForSelector('[data-testid="editor-menu-bookmark"]', { timeout: 3000 });
};
const menuLabel = () => page.textContent('[data-testid="editor-menu-bookmark"]');
const isBookmarked = () => page.evaluate(async () => {
  const raw = await window.__app.vault.adapter.readConfig("bookmarks.json");
  const parsed = JSON.parse(raw || "{}");
  return Array.isArray(parsed.items) && parsed.items.some((item) => item.type === "file" && item.path === "r162-test.md");
});

await page.evaluate(async () => {
  try { await window.__app.vault.create("r162-test.md", "hi r162"); } catch {}
  window.__app.workspace.openFile("r162-test.md");
});
await page.waitForSelector('[data-testid="editor-more-options"]', { timeout: 5000 });

console.log("— bookmark action lives in the view menu —");
await openMenu();
ok("bookmark menu action is visible", await page.isVisible('[data-testid="editor-menu-bookmark"]'));
ok("default action is Bookmark", /bookmark/i.test((await menuLabel()) || ""));
await page.click('[data-testid="editor-menu-bookmark"]');
await wait(80);
ok("menu action bookmarks the active file", await isBookmarked());
await page.evaluate(() => window.__app.commands.execute("bookmarks:bookmark-file"));
await wait(80);
await openMenu();
ok("command path can unbookmark the same active file", !(await isBookmarked()));
await page.click('[data-testid="editor-more-options"]');

console.log("— menu is editor-only —");
await page.evaluate(() => window.__app.workspace.openGraph());
await wait(120);
ok("editor view menu is absent on graph tab", (await page.$('[data-testid="editor-more-options"]')) === null);
ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR162: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
