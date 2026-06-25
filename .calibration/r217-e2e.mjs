/**
 * R217 — G3 §0: app:show-debug-info (Obsidian "Show debug info"). Copies a system-info
 * block (Geode version / platform / locale / plugins installed+enabled+list) to the
 * clipboard for bug reports, reusing R183's command-notice toast. buildDebugInfo is pure
 * (core/debugInfo.ts), probed via window.__geodeDebugInfo.
 * Browser :1420.  Run: node .calibration/r217-e2e.mjs
 * Contract: ARCHITECTURE "Round 217 additions".
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
const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r217", name: "r217", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app && !!window.__geodeDebugInfo, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("A. pure buildDebugInfo (window.__geodeDebugInfo): format + enabled-only numbering");
const built = await app(() => window.__geodeDebugInfo({
  version: "1.2.3", platform: "TestOS", locale: "en",
  plugins: [
    { name: "Alpha", id: "alpha", enabled: true },
    { name: "Beta", id: "beta", enabled: false },
    { name: "Gamma", id: "gamma", enabled: true },
  ],
}));
const expected = "Geode debug info:\nVersion: 1.2.3\nPlatform: TestOS\nLocale: en\nPlugins installed: 3\nPlugins enabled: 2\n1. Alpha (alpha)\n2. Gamma (gamma)";
ok("buildDebugInfo formats the block + numbers ONLY enabled plugins", built === expected, JSON.stringify(built));

console.log("B. command registration");
const reg = await app(() => {
  const c = window.__app.commands.list().find((x) => x.id === "app:show-debug-info");
  return { present: !!c, name: c ? c.name() : null, hotkey: window.__app.commands.getEffectiveHotkey("app:show-debug-info") || null };
});
ok("app:show-debug-info registered", reg.present, JSON.stringify(reg));
ok("name resolves via i18n", reg.name === "Show debug info", JSON.stringify(reg));
ok("no default hotkey", reg.hotkey === null);

console.log("C. executing it copies the live debug info + shows the toast");
await app(() => window.__app.commands.execute("app:show-debug-info"));
await wait(150);
ok("command-notice toast shown with the copied message",
  await app(() => { const el = document.querySelector('[data-testid="command-notice"]'); return !!el && el.textContent.includes("Debug info copied"); }));
const clip = await app(() => navigator.clipboard.readText().catch(() => "(denied)"));
ok("clipboard holds the debug-info block (header + version + plugins lines)",
  clip.startsWith("Geode debug info:") && /\nVersion: \d+\.\d+\.\d+/.test(clip) && clip.includes("Plugins installed:"),
  JSON.stringify(clip.slice(0, 120)));
ok("clipboard reports the r217 probe plugin among enabled", clip.includes("(r217)"), JSON.stringify(clip));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR217: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
