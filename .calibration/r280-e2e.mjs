/**
 * R280 — Vault manager + Explorer active state CSS.
 * Browser :1420.   Run: node .calibration/r280-e2e.mjs
 * Contract: docs/ARCHITECTURE.md "Round 280 additions".
 *
 * A = vault manager modal: title/recents/remove/open-other present; create-new absent (browser only).
 * B = remove a recent → list update.
 * C = Explorer active state: neutral background with no colored accent edge.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r280", name: "r280", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clearRecents = () => app(() => localStorage.removeItem("geode.recentVaults"));
const setRecents = (val) => app((v) => localStorage.setItem("geode.recentVaults", JSON.stringify(v)), val);
const loadRecents = () => app(() => JSON.parse(localStorage.getItem("geode.recentVaults") || "[]"));

console.log("A. vault manager modal elements");
await clearRecents();
await setRecents(["/Users/me/Alpha", "/Users/me/Beta"]);
await app(() => window.__app.commands.execute("app:switch-vault"));
await page.waitForSelector('[data-testid="vaultmanager-modal"]', { timeout: 3000 });
ok("vault manager modal present", (await page.$('[data-testid="vaultmanager-modal"]')) !== null);
ok("modal title present", (await page.$('[data-testid="vaultmanager-title"]')) !== null);
const itemCount = (await page.$$('[data-testid="vaultmanager-item"]')).length;
ok("recent items present (2)", itemCount === 2, String(itemCount));
const menuBtns = await page.$$('[data-testid="vaultmanager-item"] [data-testid="vaultmanager-record-more"]');
ok("each item has an Obsidian-style record menu", menuBtns.length === 2, String(menuBtns.length));
ok("'Open another vault' button present", (await page.$('[data-testid="vaultmanager-open-other"]')) !== null);
ok("'Create new vault' button NOT present (browser mode)", (await page.$('[data-testid="vaultmanager-create-new"]')) === null);
await app(() => window.__app.workspace.closeModal());
await wait(80);

console.log("B. remove a recent → list updates");
await clearRecents();
await setRecents(["/Users/me/Alpha", "/Users/me/Beta"]);
await app(() => window.__app.commands.execute("app:switch-vault"));
await page.waitForSelector('[data-testid="vaultmanager-modal"]', { timeout: 3000 });
await page.click('[data-testid="vaultmanager-item"] [data-testid="vaultmanager-record-more"]');
await page.waitForSelector('[data-testid="vaultmanager-record-menu"]');
await page.click('[data-testid="vaultmanager-remove"]'); // removes first (Alpha)
await wait(120);
const itemsAfter = await page.$$('[data-testid="vaultmanager-item"]');
ok("only 1 item remains after remove", itemsAfter.length === 1, String(itemsAfter.length));
const recentsAfter = await loadRecents();
ok("localStorage updated (Alpha gone, Beta remains)", JSON.stringify(recentsAfter) === JSON.stringify(["/Users/me/Beta"]), JSON.stringify(recentsAfter));
await app(() => window.__app.workspace.closeModal());
await wait(80);

console.log("C. Explorer active state CSS");
// create a note and open it to get .is-active
await app(async () => {
  try { await window.__app.vault.create("r280-test.md", "test"); } catch {}
});
await app(() => window.__app.workspace.openFile("r280-test.md"));
await wait(150);
// get the active item's computed style
const activeStyle = await page.evaluate(() => {
  const el = document.querySelector(".explorer-item.is-active");
  if (!el) return null;
  const cs = getComputedStyle(el);
  const probe = document.createElement("span");
  probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--text-normal").trim();
  document.body.appendChild(probe);
  const neutralColor = getComputedStyle(probe).color;
  probe.remove();
  return {
    background: cs.backgroundColor,
    boxShadow: cs.boxShadow,
    borderLeft: cs.borderLeft,
    color: cs.color,
    neutralColor,
  };
});
ok(".explorer-item.is-active exists", activeStyle !== null);
if (activeStyle) {
  // Obsidian's file list uses a neutral active row, not the accent color.
  const bg = activeStyle.background;
  ok("active background is not transparent", bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent" && bg !== "");
  ok("active row has no colored left accent bar", activeStyle.boxShadow === "none");
  ok("active color is neutral text", activeStyle.color === activeStyle.neutralColor, JSON.stringify(activeStyle));
}

// clean up
await app(() => {
  if (window.__app.vault.fileExists("r280-test.md")) {
    window.__app.vault.remove("r280-test.md");
  }
});

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR280: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
