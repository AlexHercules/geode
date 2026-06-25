/**
 * R218 — G3 §6: file-explorer:reveal-in-system + open-in-default-app
 * (Obsidian "Show in system explorer" / "Open in default app"). Desktop-only OS-shell
 * actions: a thin Rust command safe_join's the vault-relative path before calling
 * tauri-plugin-opener. In BROWSER mode (isTauri false) the commands are gated off and the
 * core/reveal helpers no-op — that browser degradation is what this suite proves. The
 * real invoke→safe_join confinement is covered by the desktop probe (r218-probe.mjs).
 * Browser :1420.  Run: node .calibration/r218-e2e.mjs
 * Contract: ARCHITECTURE "Round 218 additions".
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r218", name: "r218", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeReveal, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("A. command registration + i18n names");
const ids = ["file-explorer:reveal-in-system", "file-explorer:open-in-default-app"];
const reg = await app((cmdIds) => cmdIds.map((id) => {
  const c = window.__app.commands.list().find((x) => x.id === id);
  return { id, present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey(id) || null };
}), ids);
ok("reveal-in-system registered", reg[0].present, JSON.stringify(reg[0]));
ok("reveal name resolves via i18n", reg[0].name === "Files: Show in system explorer", JSON.stringify(reg[0]));
ok("reveal has no default hotkey", reg[0].hotkey === null, JSON.stringify(reg[0]));
ok("open-in-default-app registered", reg[1].present, JSON.stringify(reg[1]));
ok("open name resolves via i18n", reg[1].name === "Files: Open in default app", JSON.stringify(reg[1]));
ok("open has no default hotkey", reg[1].hotkey === null, JSON.stringify(reg[1]));

console.log("B. available() gating — isTauri gate keeps them OFF in the browser EVEN with an active file");
await app(async () => { try { await window.__app.vault.create("RevealMe.md", "hi\n"); } catch { /* exists */ } });
await wait(150);
await app(() => window.__app.workspace.openFile("RevealMe.md"));
await wait(150);
const gate = await app((cmdIds) => {
  const active = window.__app.workspace.getActiveFile();
  return {
    active,
    avail: cmdIds.map((id) => {
      const c = window.__app.commands.list().find((x) => x.id === id);
      return c && c.available ? c.available() : null;
    }),
  };
}, ids);
ok("an active file is open (getActiveFile non-null)", gate.active === "RevealMe.md", JSON.stringify(gate));
ok("reveal available()===false in browser despite active file (isTauri gate)", gate.avail[0] === false, JSON.stringify(gate));
ok("open available()===false in browser despite active file (isTauri gate)", gate.avail[1] === false, JSON.stringify(gate));

console.log("C. core/reveal helpers no-op in browser (resolve, no throw — lazy @tauri-apps import never runs)");
const noop = await app(async () => {
  const out = { reveal: "?", open: "?" };
  try { out.reveal = (await window.__geodeReveal.revealInSystem("/fake/root", "RevealMe.md")) === undefined ? "noop" : "value"; }
  catch (e) { out.reveal = "threw:" + String(e && e.message || e); }
  try { out.open = (await window.__geodeReveal.openInDefaultApp("/fake/root", "RevealMe.md")) === undefined ? "noop" : "value"; }
  catch (e) { out.open = "threw:" + String(e && e.message || e); }
  return out;
});
ok("revealInSystem is a no-op in browser", noop.reveal === "noop", JSON.stringify(noop));
ok("openInDefaultApp is a no-op in browser", noop.open === "noop", JSON.stringify(noop));

console.log("D. right-click menu items are HIDDEN in browser mode (isTauri gate on the JSX)");
// Open the file context menu on a known seeded root file, then assert the two new items
// are absent (copy-path IS present — sanity that the menu rendered).
const fileRow = page.locator('[data-testid="explorer-item"][data-path="Welcome.md"]').first();
await fileRow.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
await fileRow.click({ button: "right" }).catch(() => {});
await wait(200);
const menuVisible = await app(() => !!document.querySelector('[data-testid="explorerctx-copy-path"]'));
ok("a file context menu is open (copy-path item present — sanity)", menuVisible);
ok("reveal-in-system menu item is hidden in browser",
  await app(() => !document.querySelector('[data-testid="explorerctx-reveal-in-system"]')));
ok("open-in-default-app menu item is hidden in browser",
  await app(() => !document.querySelector('[data-testid="explorerctx-open-in-default-app"]')));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR218: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
