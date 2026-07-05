/**
 * R259 — second COMMITTED real-plugin proof. Loads the genuine, unmodified MIT plugin
 * "Words to Read Time" 1.0.0 (vendored at compat-fixtures/obsidian-read-time-plugin/) through
 * the real compat/obsidian/loader.ts path, and asserts its status-bar reading-time output.
 * This broadens R258's coverage (commands + editor) to a COMPLEMENTARY surface: a real plugin
 * with NO commands that uses addStatusBarItem + registerInterval + registerDomEvent(document,
 * "click") + getActiveViewOfType(MarkdownView) + a real PluginSettingTab. It reads the active
 * note's word count and writes "<m>m <s>s read time" (default 130 wpm) to the status bar — so
 * a real lifecycle/status-bar plugin demonstrably runs and reads live editor state.
 * Run: node .calibration/r259-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 259 additions".
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dir, "..", "compat-fixtures", "obsidian-read-time-plugin");
const mainJs = readFileSync(join(FIXTURE_DIR, "main.js"), "utf8");
const manifestJson = readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8");
const PLUGIN_ID = JSON.parse(manifestJson).id; // "obsidian-read-time-plugin"

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

await page.addInitScript(({ mainJs, manifestJson, id }) => {
  window.__geodeObsidianPlugins = [{ dir: id, manifestJson, mainJs, stylesCss: null, dataJson: null }];
  window.__geodeObsidianConfig = { "community-plugins.json": JSON.stringify([id]) };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
}, { mainJs, manifestJson, id: PLUGIN_ID });

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.waitForFunction(
  (id) => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === id),
  PLUGIN_ID, { timeout: 8000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// find the leaf element rendering the plugin's "<m>m <s>s read time" status bar text
const readTimeText = () => ev(() => {
  const el = Array.from(document.querySelectorAll("*")).find(
    (e) => e.children.length === 0 && /\d+m \d+s read time/.test(e.textContent || ""));
  return el ? el.textContent.trim() : null;
});

console.log("— the genuine MIT plugin (ES6, no commands) loaded + ENABLED —");
const report = await ev((id) => {
  const r = window.geode.app.obsidianLoadReport?.get?.() ?? [];
  return r.find((x) => x.id === id) ?? null;
}, PLUGIN_ID);
ok("plugin present in obsidianLoadReport", !!report, JSON.stringify(report));
ok("plugin status = enabled (loaded + onload ran clean)", report?.status === "enabled", JSON.stringify(report));

console.log("— it added a status bar item showing the initial '0m 0s read time' —");
await wait(300);
const initial = await readTimeText();
ok("status bar shows the read-time format on load", initial !== null && /read time/.test(initial), JSON.stringify(initial));

console.log("— open a 260-word note: the plugin computes ~2 min (260 words / 130 wpm) —");
const WORDS = 260;
await ev(async (n) => {
  const body = Array.from({ length: n }, () => "word").join(" ") + "\n";
  try { await window.geode.app.vault.create("rt.md", body); } catch { /* exists */ }
  window.geode.app.workspace.openFile("rt.md");
}, WORDS);
await wait(200);
await ev(() => { const t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "source"); });
await page.waitForSelector(".cm-content", { timeout: 5000 });
// click in the editor: focuses it so getActiveViewOfType returns the live source view.
// (The recompute itself is driven by the plugin's 500ms registerInterval; the plugin's
// registerDomEvent("click") handler only console.logs — the wait(700) below covers the interval.)
await page.click(".cm-content");
await wait(700); // let the registerInterval recompute fire
const computed = await readTimeText();
ok("status bar updated to a non-zero reading time (real plugin read the live word count)",
  computed !== null && computed !== "0m 0s read time" && /\d+m \d+s read time/.test(computed), JSON.stringify(computed));
const mins = computed ? parseInt(computed, 10) : -1;
ok("computed ~2 min for 260 words @130wpm (within 1-3)", mins >= 1 && mins <= 3, JSON.stringify(computed));

console.log("— it recomputes per active note: a 13-word note drops to ~0 min (dynamic, not a fluke) —");
// (the PluginSettingTab + addStatusBarItem + registerInterval + registerDomEvent calls in
// onload are all proven to have run by status==="enabled" above — onload would have thrown
// otherwise. Here we prove the plugin keeps recomputing from the LIVE active note.)
await ev(async () => {
  try { await window.geode.app.vault.create("rt-short.md", "just thirteen little words here to keep this estimate well under a minute\n"); } catch { /* exists */ }
  window.geode.app.workspace.openFile("rt-short.md");
});
await wait(200);
await ev(() => { const t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "source"); });
await page.click(".cm-content");
await wait(700);
const shortTime = await readTimeText();
ok("status bar recomputed for the short note (≈0 min, different from the 260-word note)",
  shortTime !== null && /\d+m \d+s read time/.test(shortTime) && parseInt(shortTime, 10) === 0 && shortTime !== computed, JSON.stringify(shortTime));

ok("no uncaught page errors (real plugin ran clean)", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR259 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
