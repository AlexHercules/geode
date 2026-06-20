/**
 * R121 compat app.commands.removeCommand E2E — browser mode :1420.
 * Run: node .calibration/r121-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 121 additions" (compat 商业主轴, 收 R113/R118 余项).
 *
 * Obsidian app.commands.removeCommand(id): void — removes the command from the registry. Backed
 * by new core CommandRegistry.removeById (delete + revision bump, mirrors the register() disposer).
 * Unknown id → no-op (no throw, no bump).
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
await page.waitForFunction(() => !!window.geode && !!window.app && !!window.app.commands && typeof window.app.commands.removeCommand === "function", null, { timeout: 15000 });

await page.evaluate(() => {
  const reg = window.app._geode.handle.commands;
  reg.register({ id: "r121:doomed", name: "R121 Doomed", callback: () => {} });
  reg.register({ id: "r121:keep", name: "R121 Keep", callback: () => {} });
});

const ev = (fn, arg) => page.evaluate(fn, arg);

console.log("— removeCommand removes a command everywhere —");
ok("the seeded command is present before removal", await ev(() => !!window.app.commands.findCommand("r121:doomed")));
ok("removeCommand(id) returns undefined (Obsidian void)", await ev(() => window.app.commands.removeCommand("r121:doomed") === undefined));
ok("findCommand(removed) → undefined", await ev(() => window.app.commands.findCommand("r121:doomed") === undefined));
ok("executeCommandById(removed) → false", await ev(() => window.app.commands.executeCommandById("r121:doomed") === false));
ok("listCommands no longer includes the removed id", await ev(() => !window.app.commands.listCommands().some((c) => c.id === "r121:doomed")));
ok("commands record no longer maps the removed id", await ev(() => window.app.commands.commands["r121:doomed"] === undefined));

console.log("— other commands are unaffected —");
ok("the kept command is still present", await ev(() => window.app.commands.findCommand("r121:keep")?.name === "R121 Keep"));
ok("the kept command still executes", await ev(() => window.app.commands.executeCommandById("r121:keep") === true));

console.log("— unknown id is a no-op —");
ok("removeCommand(unknown) does not throw + returns undefined", await ev(() => {
  try { return window.app.commands.removeCommand("r121:never-existed") === undefined; }
  catch { return false; }
}));

console.log("— live: re-registering after removal works —");
ok("a command can be re-registered after removeCommand", await ev(() => {
  const reg = window.app._geode.handle.commands;
  reg.register({ id: "r121:doomed", name: "R121 Reborn", callback: () => {} });
  return window.app.commands.findCommand("r121:doomed")?.name === "R121 Reborn";
}));

console.log(`\nR121 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
