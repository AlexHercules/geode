/**
 * R258 — first COMMITTED real-plugin proof. Loads the genuine, unmodified MIT community
 * plugin "Sort & Permute lines" 0.7.0 (vendored at compat-fixtures/obsidian-sort-and-permute-lines/)
 * through the REAL compat/obsidian/loader.ts path in browser mode, drives its commands, and
 * asserts BYTE-LEVEL editor output + autosave to disk. This converts "5 real plugins load,
 * trust me (manual desktop probe)" into an automated regression that a real third-party plugin
 * runs correctly. KEY data-safety assertion (底线①): the plugin rewrites the document via the
 * obsidian Editor shim (setValue/replaceRange) — those dispatch through CM6 → docChanged →
 * autosave, exactly like native edits, so a plugin edit must reach disk and never be lost.
 * Run: node .calibration/r258-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 258 additions".
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dir, "..", "compat-fixtures", "obsidian-sort-and-permute-lines");
const mainJs = readFileSync(join(FIXTURE_DIR, "main.js"), "utf8");
const manifestJson = readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8");
const PLUGIN_ID = JSON.parse(manifestJson).id; // "obsidian-sort-and-permute-lines"

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

// inject the REAL vendored plugin bundle + enable it, before bootstrap runs the loader
await page.addInitScript(({ mainJs, manifestJson, id }) => {
  window.__geodeObsidianPlugins = [{ dir: id, manifestJson, mainJs, stylesCss: null, dataJson: null }];
  window.__geodeObsidianConfig = { "community-plugins.json": JSON.stringify([id]) };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
}, { mainJs, manifestJson, id: PLUGIN_ID });

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
// the loader runs at boot; wait until the real plugin's commands appear
await page.waitForFunction(
  (id) => (window.geode?.app?.commands?.list?.() ?? []).some((c) => c.id === id + ":sort-alphabetically"),
  PLUGIN_ID, { timeout: 8000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => ev((x) => window.geode.app.vault.read(x), p);
const lines = (s) => (s ?? "").split("\n").filter(Boolean).join("|");

console.log("— the genuine MIT plugin loaded + ENABLED through the real loader path —");
const report = await ev((id) => {
  const r = window.geode.app.obsidianLoadReport?.get?.() ?? [];
  return r.find((x) => x.id === id) ?? null;
}, PLUGIN_ID);
ok("plugin present in obsidianLoadReport", !!report, JSON.stringify(report));
ok("plugin status = enabled (loaded + onload ran clean)", report?.status === "enabled", JSON.stringify(report));

console.log("— its commands registered (namespaced <pluginId>:<cmd>) —");
const cmds = await ev((id) => window.geode.app.commands.list().filter((c) => c.id.startsWith(id + ":")).map((c) => c.id), PLUGIN_ID);
ok("sort-alphabetically command registered", cmds.includes(PLUGIN_ID + ":sort-alphabetically"), JSON.stringify(cmds));
ok("permute-reverse command registered", cmds.includes(PLUGIN_ID + ":permute-reverse"));
ok(">= 10 plugin commands registered (full addCommand surface)", cmds.length >= 10, String(cmds.length));

console.log("— sort-alphabetically rewrites the doc (byte-level) + AUTOSAVES to disk (底线①) —");
await ev(async () => {
  try { await window.geode.app.vault.create("sp.md", "banana\napple\ncherry\n"); } catch { /* exists */ }
  window.geode.app.workspace.openFile("sp.md");
});
await wait(150);
await ev(() => { const t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "source"); });
await page.waitForSelector(".cm-content", { timeout: 5000 });
await page.click(".cm-content");
await wait(120);
await ev((id) => window.geode.app.commands.execute(id + ":sort-alphabetically"), PLUGIN_ID);
await wait(150);
const sorted = await ev(() => window.app.workspace.activeEditor?.editor?.getValue() ?? null);
ok("editor content sorted alphabetically (real plugin ran)", lines(sorted) === "apple|banana|cherry", JSON.stringify(sorted));
await wait(700); // autosave debounce flush
ok("the plugin edit AUTOSAVED to disk — not lost (底线①)", lines(await read("sp.md")) === "apple|banana|cherry", await read("sp.md"));

console.log("— permute-reverse reverses the now-sorted lines + autosaves —");
await page.click(".cm-content");
await wait(100);
await ev((id) => window.geode.app.commands.execute(id + ":permute-reverse"), PLUGIN_ID);
await wait(150);
const rev = await ev(() => window.app.workspace.activeEditor?.editor?.getValue() ?? null);
ok("permute-reverse reversed the lines", lines(rev) === "cherry|banana|apple", JSON.stringify(rev));
await wait(700);
ok("reverse autosaved to disk (底线①)", lines(await read("sp.md")) === "cherry|banana|apple", await read("sp.md"));

console.log("— R258 hardening: a deliberately-broken plugin reports its REAL onload error —");
// inject a second plugin whose onload throws a distinctive message, in a fresh page
const badPage = await browser.newPage();
await badPage.addInitScript(() => {
  window.__geodeObsidianPlugins = [{
    dir: "r258-bad",
    manifestJson: JSON.stringify({ id: "r258-bad", name: "R258 Bad", version: "1.0.0", minAppVersion: "0.0.1" }),
    mainJs: "module.exports = class extends require('obsidian').Plugin { onload(){ throw new Error('R258_BOOM'); } onunload(){} };",
    stylesCss: null, dataJson: null,
  }];
  window.__geodeObsidianConfig = { "community-plugins.json": '["r258-bad"]' };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
});
await badPage.goto(BASE_URL);
await badPage.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await badPage.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === "r258-bad"), null, { timeout: 8000 });
const badReport = await badPage.evaluate(() => (window.geode.app.obsidianLoadReport.get() ?? []).find((r) => r.id === "r258-bad") ?? null);
ok("broken plugin reported status=failed", badReport?.status === "failed", JSON.stringify(badReport));
ok("report carries the REAL onload error message (R258 hardening, not generic)", (badReport?.detail ?? "").includes("R258_BOOM"), JSON.stringify(badReport));
await badPage.close();

ok("no uncaught page errors (real plugin ran clean)", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR258 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
