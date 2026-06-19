/**
 * R113 compat app.commands E2E — browser mode :1420.
 * Run: node .calibration/r113-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 113 additions" (compat 商业主轴).
 *
 * Obsidian `app.commands`: executeCommandById(id)=>boolean, listCommands()=>Command[],
 * commands=Record<id,Command>. Backed by the core CommandRegistry (shared with the palette).
 * executeCommandById respects `available` (Obsidian pre-checks checkCallback(true)); command
 * names are i18n thunks internally and must surface to plugins as resolved strings.
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
await page.evaluate(() => { localStorage.setItem("geode.locale", "en"); });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.app && !!window.app.commands, null, { timeout: 15000 });

// seed three commands into the shared registry: a plain one, an unavailable one (THUNK name),
// and an available gated one — directly via the compat App's internal bridge.
await page.evaluate(() => {
  const reg = window.app._geode.handle.commands;
  window.__ran = [];
  reg.register({ id: "r113:plain", name: "R113 Plain", callback: () => window.__ran.push("plain") });
  reg.register({ id: "r113:gatedOff", name: () => "R113 Gated Off", callback: () => window.__ran.push("gatedOff"), available: () => false });
  reg.register({ id: "r113:gatedOn", name: "R113 Gated On", callback: () => window.__ran.push("gatedOn"), available: () => true });
});

const ev = (fn, arg) => page.evaluate(fn, arg);

// ── executeCommandById ──────────────────────────────────────────────────────
console.log("— executeCommandById —");
ok("runs a plain command + returns true", await ev(() => window.app.commands.executeCommandById("r113:plain") === true && window.__ran.includes("plain")));
ok("unknown id → false (no throw)", await ev(() => window.app.commands.executeCommandById("r113:nope") === false));
ok("available()===false → returns false AND does not run", await ev(() => {
  const r = window.app.commands.executeCommandById("r113:gatedOff");
  return r === false && !window.__ran.includes("gatedOff");
}));
ok("available()===true → runs + returns true", await ev(() => window.app.commands.executeCommandById("r113:gatedOn") === true && window.__ran.includes("gatedOn")));

// ── listCommands ────────────────────────────────────────────────────────────
console.log("— listCommands —");
ok("returns an array including the seeded ids", await ev(() => {
  const ids = window.app.commands.listCommands().map((c) => c.id);
  return ids.includes("r113:plain") && ids.includes("r113:gatedOff") && ids.includes("r113:gatedOn");
}));
ok("every command name is a resolved STRING (thunks resolved, none are functions)", await ev(() => window.app.commands.listCommands().every((c) => typeof c.name === "string")));
ok("the thunk-named command resolves to its string → 'R113 Gated Off'", await ev(() => {
  const c = window.app.commands.listCommands().find((x) => x.id === "r113:gatedOff");
  return c && c.name === "R113 Gated Off";
}));
ok("includes Geode's own native commands too (shared registry, not empty)", await ev(() => window.app.commands.listCommands().length > 5));

// ── commands record ─────────────────────────────────────────────────────────
console.log("— commands record —");
ok("commands[id] maps to the command (id + resolved string name)", await ev(() => {
  const c = window.app.commands.commands["r113:plain"];
  return !!c && c.id === "r113:plain" && c.name === "R113 Plain";
}));
ok("commands record reflects live registry (unregister disappears)", await ev(() => {
  const reg = window.app._geode.handle.commands;
  const dispose = reg.register({ id: "r113:temp", name: "Temp", callback: () => {} });
  const present = "r113:temp" in window.app.commands.commands;
  dispose();
  const gone = !("r113:temp" in window.app.commands.commands);
  return present && gone;
}));

console.log(`\nR113 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
