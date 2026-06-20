/**
 * R149 compat Keymap.isModEvent completion E2E — browser mode :1420.
 * Run: node .calibration/r149-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 149 additions".
 *
 * Completes Keymap.isModEvent (d.ts: 'tab' if Mod[Cmd/Ctrl] OR middle-click; 'split' if Mod+Alt;
 * 'window' if Mod+Alt+Shift). The Mod key is platform-aware (Cmd on macOS, Ctrl elsewhere), reusing
 * isModifier (R149 review). Verified platform-agnostically via the __geodeKeymapIsModEvent probe.
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r149", name: "r149", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeKeymapIsModEvent, null, { timeout: 5000 });

const ev = (kind, flags) => page.evaluate(([k, f]) => window.__geodeKeymapIsModEvent(k, f), [kind, flags]);

// the Mod key is platform-aware → determine which physical key is "Mod" on this runtime, then
// drive the combo assertions with it (platform-agnostic, mirrors the R148 isModifier XOR approach)
const metaIsMod = (await ev("keyboard", { meta: true })) === "tab";
const M = metaIsMod ? "meta" : "ctrl"; // the platform Mod flag
const N = metaIsMod ? "ctrl" : "meta"; // the non-Mod flag on this platform

console.log(`— Mod = ${M} on this runtime; combos map to the pane type —`);
ok("the platform Mod key XOR: exactly one of meta/ctrl is the Mod (→ 'tab')", metaIsMod !== ((await ev("keyboard", { ctrl: true })) === "tab"));
ok("Mod → 'tab'", (await ev("keyboard", { [M]: true })) === "tab");
ok("the NON-Mod key alone → false (not a mod event on this platform)", (await ev("keyboard", { [N]: true })) === false);
ok("Mod+Alt → 'split'", (await ev("keyboard", { [M]: true, alt: true })) === "split");
ok("Mod+Alt+Shift → 'window'", (await ev("keyboard", { [M]: true, alt: true, shift: true })) === "window");

console.log("— no modifier / partial combos → false —");
ok("no modifier → false", (await ev("keyboard", {})) === false);
ok("Alt alone (no mod) → false", (await ev("keyboard", { alt: true })) === false);
ok("Shift alone → false", (await ev("keyboard", { shift: true })) === false);
ok("Alt+Shift (no mod) → false", (await ev("keyboard", { alt: true, shift: true })) === false);

console.log("— middle-click maps to 'tab'; other mouse buttons don't —");
ok("middle-click (button 1) → 'tab'", (await ev("mouse", { button: 1 })) === "tab");
ok("left-click (button 0) → false", (await ev("mouse", { button: 0 })) === false);
ok("right-click (button 2) → false", (await ev("mouse", { button: 2 })) === false);
ok("mouse Mod+Alt (button 0) → 'split'", (await ev("mouse", { [M]: true, alt: true, button: 0 })) === "split");

console.log("— most-specific wins: Mod combos take precedence over the middle-click rule —");
ok("middle-click + Mod+Alt+Shift → 'window' (mod combo wins)", (await ev("mouse", { button: 1, [M]: true, alt: true, shift: true })) === "window");
ok("middle-click + Mod+Alt → 'split' (mod combo wins over middle→tab)", (await ev("mouse", { button: 1, [M]: true, alt: true })) === "split");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR149 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
