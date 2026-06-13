/**
 * R32 macOS Cmd (Mod) modifier-key support E2E — browser mode against dev :1420.
 * Run: node .calibration/r32-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 32 additions".
 *
 * Covers:
 *  A. grammar probe (__geodeHotkey, BOTH platform branches on a mac host):
 *     - normalize keeps Mod distinct from Ctrl
 *     - match: mac Mod→metaKey, non-mac Mod→ctrlKey; Ctrl always physical;
 *       exact modifier equality (extra Shift rejected); mac Ctrl+P ≠ Mod+P
 *     - format: non-mac "Mod+X"→"Ctrl+X" (+-joined); mac → Apple glyphs ⌃⌥⇧⌘
 *  B. live integration (real app, browser host = mac): pressing Cmd+P (Meta+P)
 *     opens the command palette; pressing Ctrl+P does NOT (mirrors Obsidian on
 *     macOS). The palette shows the ⌘-glyph hotkey (formatHotkey wiring).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r32", name: "r32", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__geodeHotkey, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- A. grammar probe -------------------------------------------------------
console.log("A. grammar probe (pure, both platforms)");

const ev = (over = {}) => ({
  metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
  key: "p", code: "KeyP", ...over,
});

const H = (fn, arg) => app(({ f, a }) => {
  // eslint-disable-next-line no-new-func
  return window.__geodeHotkey[f](...a);
}, { f: fn, a: arg });

ok("probe host reports mac (browser host is macOS dev machine)",
  (await app(() => window.__geodeHotkey.isMac)) === true);

// normalize: Mod preserved distinct from Ctrl, canonical ordering
ok("normalize mod+p → Mod+P", (await H("normalize", ["mod+p"])) === "Mod+P");
ok("normalize ctrl+p → Ctrl+P (physical, stays)", (await H("normalize", ["ctrl+p"])) === "Ctrl+P");
ok("normalize shift+mod+e → Mod+Shift+E", (await H("normalize", ["shift+mod+e"])) === "Mod+Shift+E");
ok("normalize mod+alt+arrowright → Mod+Alt+ArrowRight",
  (await H("normalize", ["mod+alt+arrowright"])) === "Mod+Alt+ArrowRight");
ok("normalize Mod+P ≠ Ctrl+P (distinct canonical)",
  (await H("normalize", ["mod+p"])) !== (await H("normalize", ["ctrl+p"])));

// match — mac branch (isMac=true): Mod resolves to metaKey
ok("mac: Mod+P matches Cmd+P (metaKey)",
  (await app((e) => window.__geodeHotkey.match("Mod+P", e, true), ev({ metaKey: true }))) === true);
ok("mac: Mod+P does NOT match Ctrl+P (ctrlKey) — Obsidian behavior",
  (await app((e) => window.__geodeHotkey.match("Mod+P", e, true), ev({ ctrlKey: true }))) === false);
ok("mac: Ctrl+P matches physical Ctrl, not Cmd",
  (await app((e) => window.__geodeHotkey.match("Ctrl+P", e, true), ev({ ctrlKey: true }))) === true &&
  (await app((e) => window.__geodeHotkey.match("Ctrl+P", e, true), ev({ metaKey: true }))) === false);
ok("mac: exact equality — Mod+P rejects extra Shift",
  (await app((e) => window.__geodeHotkey.match("Mod+P", e, true), ev({ metaKey: true, shiftKey: true }))) === false);
ok("mac: Mod+Shift+E matches Cmd+Shift+E",
  (await app((e) => window.__geodeHotkey.match("Mod+Shift+E", e, true),
    ev({ metaKey: true, shiftKey: true, key: "e", code: "KeyE" }))) === true);
ok("mac: Mod+, matches Cmd+, via physical code",
  (await app((e) => window.__geodeHotkey.match("Mod+,", e, true),
    ev({ metaKey: true, key: ",", code: "Comma" }))) === true);

// match — non-mac branch (isMac=false): Mod resolves to ctrlKey
ok("win: Mod+P matches Ctrl+P (ctrlKey)",
  (await app((e) => window.__geodeHotkey.match("Mod+P", e, false), ev({ ctrlKey: true }))) === true);
ok("win: Mod+P does NOT match Meta+P (Win key)",
  (await app((e) => window.__geodeHotkey.match("Mod+P", e, false), ev({ metaKey: true }))) === false);

// format — non-mac: Mod→Ctrl, +-joined
ok("format(non-mac) Mod+P → Ctrl+P", (await H("format", ["Mod+P", false])) === "Ctrl+P");
ok("format(non-mac) Mod+Shift+E → Ctrl+Shift+E", (await H("format", ["Mod+Shift+E", false])) === "Ctrl+Shift+E");
// format — mac: Apple glyphs, no separator, Apple order ⌃⌥⇧⌘
ok("format(mac) Mod+P → ⌘P", (await H("format", ["Mod+P", true])) === "⌘P");
ok("format(mac) Mod+Shift+E → ⇧⌘E", (await H("format", ["Mod+Shift+E", true])) === "⇧⌘E");
ok("format(mac) Mod+Alt+ArrowRight → ⌥⌘→", (await H("format", ["Mod+Alt+ArrowRight", true])) === "⌥⌘→");
ok("format(mac) Ctrl+P → ⌃P (physical control glyph)", (await H("format", ["Ctrl+P", true])) === "⌃P");

// ---- B. live integration (real app, mac host) ------------------------------
console.log("B. live integration (real app)");

// ensure no modal open, body-focused
await app(() => { window.__app.workspace.closeModal(); document.body.focus(); });
await wait(50);

// Cmd+P (Meta+P) must open the command palette — THE headline R32 fix
await page.keyboard.press("Meta+P");
await wait(120);
const afterCmdP = await app(() => window.__app.workspace.state.get().modal);
ok("Cmd+P opens the command palette (was the #1 gap)", afterCmdP === "palette", `modal=${afterCmdP}`);

// palette shows the ⌘-glyph hotkey for the command-palette command
const paletteHotkeys = await app(() =>
  [...document.querySelectorAll(".palette-hotkey")].map((el) => el.textContent));
ok("palette renders ⌘-glyph hotkeys (formatHotkey wiring)",
  paletteHotkeys.some((h) => h && h.includes("⌘")), JSON.stringify(paletteHotkeys.slice(0, 6)));

// close, then Ctrl+P must NOT open it on mac (Obsidian behavior)
await app(() => window.__app.workspace.closeModal());
await wait(50);
await page.keyboard.press("Control+P");
await wait(120);
const afterCtrlP = await app(() => window.__app.workspace.state.get().modal);
ok("Ctrl+P does NOT open palette on mac (mirrors Obsidian)", afterCtrlP !== "palette", `modal=${afterCtrlP}`);

// Cmd+, opens settings (punctuation Mod binding through the live layer)
await app(() => window.__app.workspace.closeModal());
await wait(50);
await page.keyboard.press("Meta+Comma");
await wait(120);
const afterCmdComma = await app(() => window.__app.workspace.state.get().modal);
ok("Cmd+, opens settings (punctuation Mod binding, live)", afterCmdComma === "settings", `modal=${afterCmdComma}`);
await app(() => window.__app.workspace.closeModal());

console.log(`\nR32 E2E: ${passed} passed, ${failed} failed`);
if (failed) { console.log("FAILED:", fails.join(", ")); process.exitCode = 1; }
await browser.close();
