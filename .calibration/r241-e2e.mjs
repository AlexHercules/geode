/**
 * R241 file-explorer:copy-absolute-path E2E — browser mode :1420.
 * Run: node .calibration/r241-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 241 additions".
 *
 * Obsidian's "Copy file path" copies the file's absolute OS path. It's desktop-only (the Memory
 * adapter has no vault path) so the command is gated unavailable in the browser; the OS-aware
 * join (toAbsolutePath) is exercised via the __geodeAbsolutePath probe on unix + windows inputs.
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
await page.waitForFunction(() => !!window.geode && !!window.__geodeAbsolutePath, null, { timeout: 15000 });
await page.evaluate(() => { try { localStorage.setItem("geode.locale", "en"); } catch {} });
await page.reload();
await page.waitForFunction(() => !!window.geode && !!window.__geodeAbsolutePath, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r241", name: "r241", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("— file-explorer:copy-absolute-path is registered with the native name + no key —");
ok("command registered", await app(() => window.geode.app.commands.list().some((c) => c.id === "file-explorer:copy-absolute-path")));
ok("name is 'Copy absolute path'", await app(() => {
  const c = window.geode.app.commands.list().find((x) => x.id === "file-explorer:copy-absolute-path");
  const n = typeof c.name === "function" ? c.name() : c.name;
  return n === "Copy absolute path";
}));
ok("no default hotkey", (await app(() => window.geode.app.commands.getEffectiveHotkey("file-explorer:copy-absolute-path"))) === null);

console.log("— it is desktop-gated: unavailable in the browser (no vault path), even with a file open —");
await app(async () => { try { await window.__app.vault.create("note.md", "# n\n"); } catch {} window.__app.workspace.openFile("note.md"); });
await wait(80);
ok("a file is active", (await app(() => window.__app.workspace.getActiveFile())) === "note.md");
ok("getVaultPath() is null in the memory vault", (await app(() => window.__app.vault.getVaultPath())) === null);
ok("command available() is false in the browser", await app(() => {
  const c = window.geode.app.commands.list().find((x) => x.id === "file-explorer:copy-absolute-path");
  return typeof c.available === "function" ? c.available() === false : false;
}));

console.log("— the OS-aware join (toAbsolutePath probe) is correct on unix + windows —");
ok("unix: /Users/x/v + a/b.md → /Users/x/v/a/b.md", (await app(() => window.__geodeAbsolutePath("/Users/x/v", "a/b.md"))) === "/Users/x/v/a/b.md");
ok("unix trailing slash stripped: /Users/x/v/ + a.md → /Users/x/v/a.md", (await app(() => window.__geodeAbsolutePath("/Users/x/v/", "a.md"))) === "/Users/x/v/a.md");
ok("windows: C:\\x\\v + a/b.md → C:\\x\\v\\a\\b.md (sep + rel converted)", (await app(() => window.__geodeAbsolutePath("C:\\x\\v", "a/b.md"))) === "C:\\x\\v\\a\\b.md");
ok("windows trailing backslash stripped", (await app(() => window.__geodeAbsolutePath("C:\\x\\v\\", "a.md"))) === "C:\\x\\v\\a.md");
ok("root-level file: /v + note.md → /v/note.md", (await app(() => window.__geodeAbsolutePath("/v", "note.md"))) === "/v/note.md");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR241 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed ? 1 : 0);
