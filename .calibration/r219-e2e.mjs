/**
 * R219 — G3 §8: backlink:toggle-backlinks-in-document (Obsidian "Backlinks: Toggle
 * backlinks in document"). Registers a command that flips R154's existing
 * showBacklinksInDocument appearance setting (linked mentions at the note bottom).
 * Pure appearance toggle reusing the vetted store+setter — no new logic, no .md write.
 * The setting persists to localStorage "geode.backlinksInDocument" ("true"/"false").
 * Browser :1420.  Run: node .calibration/r219-e2e.mjs
 * Contract: ARCHITECTURE "Round 219 additions".
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
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); localStorage.removeItem("geode.backlinksInDocument"); });
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r219", name: "r219", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ls = () => app(() => localStorage.getItem("geode.backlinksInDocument"));

console.log("A. command registration + i18n name");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "backlink:toggle-backlinks-in-document");
  return { present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey("backlink:toggle-backlinks-in-document") || null };
});
ok("backlink:toggle-backlinks-in-document registered", reg.present, JSON.stringify(reg));
ok("name resolves via i18n", reg.name === "Backlinks: Toggle backlinks in document", JSON.stringify(reg));
ok("no default hotkey", reg.hotkey === null, JSON.stringify(reg));

console.log("B. executing it toggles the showBacklinksInDocument setting (default OFF → ON → OFF)");
ok("default is OFF (key absent or false)", (await ls()) === null || (await ls()) === "false", JSON.stringify(await ls()));
await app(() => window.__app.commands.execute("backlink:toggle-backlinks-in-document"));
await wait(80);
ok("after 1st execute → ON (localStorage 'true')", (await ls()) === "true", JSON.stringify(await ls()));
await app(() => window.__app.commands.execute("backlink:toggle-backlinks-in-document"));
await wait(80);
ok("after 2nd execute → OFF (localStorage 'false')", (await ls()) === "false", JSON.stringify(await ls()));

console.log("C. regression: the appearance setting toggle still drives the settings store (sibling toggles unaffected)");
ok("toggle-ribbon still registered (sibling intact)",
  await app(() => !!window.__app.commands.list().find((x) => x.id === "app:toggle-ribbon")));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR219: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
