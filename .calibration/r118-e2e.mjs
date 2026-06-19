/**
 * R118 compat app.commands remaining members E2E — browser mode :1420.
 * Run: node .calibration/r118-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 118 additions" (compat 商业主轴).
 *
 * Extends R113 (executeCommandById/listCommands/commands) with findCommand(id) / executeCommand(cmd)
 * / editorCommands, over the core CommandRegistry. executeCommand respects `available` (same as
 * executeCommandById). editorCommands is always {} (Geode flattens editor-scoped commands).
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

await page.evaluate(() => {
  const reg = window.app._geode.handle.commands;
  window.__ran = [];
  reg.register({ id: "r118:plain", name: "R118 Plain", callback: () => window.__ran.push("plain") });
  reg.register({ id: "r118:gatedOff", name: () => "R118 Gated Off", callback: () => window.__ran.push("gatedOff"), available: () => false });
  reg.register({ id: "r118:gatedOn", name: "R118 Gated On", callback: () => window.__ran.push("gatedOn"), available: () => true });
});

const ev = (fn, arg) => page.evaluate(fn, arg);

// ── findCommand ─────────────────────────────────────────────────────────────
console.log("— findCommand —");
ok("findCommand(id) returns the command with a resolved string name", await ev(() => {
  const c = window.app.commands.findCommand("r118:plain");
  return !!c && c.id === "r118:plain" && c.name === "R118 Plain";
}));
ok("findCommand resolves a thunk name → 'R118 Gated Off'", await ev(() => window.app.commands.findCommand("r118:gatedOff")?.name === "R118 Gated Off"));
ok("findCommand(unknown) → undefined", await ev(() => window.app.commands.findCommand("r118:nope") === undefined));

// ── executeCommand(command) ──────────────────────────────────────────────────
console.log("— executeCommand(command object) —");
ok("executeCommand({id}) runs the command + returns true", await ev(() => window.app.commands.executeCommand({ id: "r118:plain" }) === true && window.__ran.includes("plain")));
ok("executeCommand respects available()===false → false, does NOT run", await ev(() => {
  const r = window.app.commands.executeCommand({ id: "r118:gatedOff" });
  return r === false && !window.__ran.includes("gatedOff");
}));
ok("executeCommand on an available command runs + returns true", await ev(() => window.app.commands.executeCommand({ id: "r118:gatedOn" }) === true && window.__ran.includes("gatedOn")));
ok("executeCommand(unknown id) → false (no throw)", await ev(() => window.app.commands.executeCommand({ id: "r118:nope" }) === false));
ok("executeCommand(found command from findCommand) round-trips", await ev(() => {
  const c = window.app.commands.findCommand("r118:plain");
  return window.app.commands.executeCommand(c) === true;
}));

// ── editorCommands ───────────────────────────────────────────────────────────
console.log("— editorCommands (Geode flattens editor-scoped → empty) —");
ok("editorCommands is a plain object", await ev(() => { const e = window.app.commands.editorCommands; return e && typeof e === "object" && !Array.isArray(e); }));
ok("editorCommands is empty (no separately-tracked editor commands) + no throw", await ev(() => Object.keys(window.app.commands.editorCommands).length === 0));

// ── R113 members still work (no regression) ──────────────────────────────────
console.log("— R113 members intact —");
ok("executeCommandById still works", await ev(() => window.app.commands.executeCommandById("r118:plain") === true));
ok("listCommands still includes the seeded ids", await ev(() => window.app.commands.listCommands().some((c) => c.id === "r118:gatedOn")));
ok("commands record still maps id → command", await ev(() => window.app.commands.commands["r118:plain"]?.name === "R118 Plain"));

console.log(`\nR118 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
