/**
 * R148 compat Keymap.isModifier E2E — browser mode :1420.
 * Run: node .calibration/r148-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 148 additions".
 *
 * Adds the confirmed-missing @public static Keymap.isModifier(evt, modifier) (obsidian.d.ts:4558
 * Modifier = Mod|Ctrl|Meta|Shift|Alt). "Mod" = Cmd on macOS, Ctrl elsewhere. Verified via the
 * __geodeKeymapIsModifier probe hook (builds a synthetic KeyboardEvent with the given flags).
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
await page.evaluate(() => window.geode.registerPlugin({ id: "r148", name: "r148", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeKeymapIsModifier, null, { timeout: 5000 });

const isMod = (modifier, flags) => page.evaluate(([m, f]) => window.__geodeKeymapIsModifier(m, f), [modifier, flags]);

console.log("— each concrete modifier matches its own event flag —");
ok("Ctrl + {ctrl} → true", (await isMod("Ctrl", { ctrl: true })) === true);
ok("Ctrl + {} → false", (await isMod("Ctrl", {})) === false);
ok("Meta + {meta} → true", (await isMod("Meta", { meta: true })) === true);
ok("Shift + {shift} → true", (await isMod("Shift", { shift: true })) === true);
ok("Alt + {alt} → true", (await isMod("Alt", { alt: true })) === true);

console.log("— a modifier does NOT match a different modifier's flag —");
ok("Ctrl + {meta} → false (Ctrl ≠ Meta)", (await isMod("Ctrl", { meta: true })) === false);
ok("Meta + {ctrl} → false (Meta ≠ Ctrl)", (await isMod("Meta", { ctrl: true })) === false);
ok("Shift + {alt} → false", (await isMod("Shift", { alt: true })) === false);
ok("Alt + {ctrl,meta,shift} → false (alt absent)", (await isMod("Alt", { ctrl: true, meta: true, shift: true })) === false);

console.log("— 'Mod' maps to the platform's modifier (Cmd on macOS, Ctrl elsewhere) —");
const modMeta = await isMod("Mod", { meta: true });
const modCtrl = await isMod("Mod", { ctrl: true });
ok("'Mod' responds to exactly ONE of meta/ctrl (the platform key)", modMeta !== modCtrl, `meta=${modMeta} ctrl=${modCtrl}`);
ok("'Mod' + {} (neither) → false", (await isMod("Mod", {})) === false);
ok("'Mod' + {shift} → false (shift is not the mod key)", (await isMod("Mod", { shift: true })) === false);

console.log("— an unknown modifier string (untyped JS caller) returns false, never undefined —");
const bogus = await isMod("Cmd", { ctrl: true, meta: true }); // 'Cmd' is NOT a valid Modifier
ok("unknown modifier 'Cmd' → false (stays boolean, not undefined)", bogus === false, `got ${JSON.stringify(bogus)}`);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR148 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
