/**
 * R291 — Help and release notes commands.
 * Run: node .calibration/r291-e2e.mjs (dev server :1420 must be running).
 */
import { chromium } from "playwright";

const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const failures = [];
function ok(name, condition, extra = "") {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.geode?.app, null, { timeout: 15000 });
await page.evaluate(() => {
  localStorage.setItem("geode.locale", "en");
  window.geode.registerPlugin({ id: "r291", name: "r291", onload(app) { window.__app = app; } });
});
await page.waitForFunction(() => !!window.__app?.commands, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);

console.log("A. commands registered and named");
ok("app:open-help is registered", await app(() => window.__app.commands.list().some((c) => c.id === "app:open-help")));
ok("app:open-release-notes is registered", await app(() => window.__app.commands.list().some((c) => c.id === "app:open-release-notes")));
ok("app:open-help name resolves (not raw key)", await app(() => {
  const cmd = window.__app.commands.list().find((c) => c.id === "app:open-help");
  const name = typeof cmd?.name === "function" ? cmd.name() : cmd?.name;
  return !!cmd && name !== "cmd.openHelp" && !name.includes("cmd.openHelp");
}));
ok("app:open-release-notes name resolves (not raw key)", await app(() => {
  const cmd = window.__app.commands.list().find((c) => c.id === "app:open-release-notes");
  const name = typeof cmd?.name === "function" ? cmd.name() : cmd?.name;
  return !!cmd && name !== "cmd.openReleaseNotes" && !name.includes("cmd.openReleaseNotes");
}));

console.log("B. callbacks open the expected URLs");
const helpUrl = await app(() => {
  const original = window.open;
  let captured = null;
  window.open = (url) => { captured = url; return null; };
  try { window.__app.commands.execute("app:open-help"); } finally { window.open = original; }
  return captured;
});
ok("app:open-help opens GitHub readme", helpUrl === "https://github.com/AlexHercules/geode#readme", JSON.stringify({ helpUrl }));

const notesUrl = await app(() => {
  const original = window.open;
  let captured = null;
  window.open = (url) => { captured = url; return null; };
  try { window.__app.commands.execute("app:open-release-notes"); } finally { window.open = original; }
  return captured;
});
ok("app:open-release-notes opens GitHub releases", notesUrl === "https://github.com/AlexHercules/geode/releases", JSON.stringify({ notesUrl }));

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
await browser.close();
console.log(`\nR291 e2e: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", failures.join(", "));
process.exit(failed ? 1 : 0);
