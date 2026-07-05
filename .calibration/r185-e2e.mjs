/**
 * R185 — G3 partial→done: view/appearance toggle commands + show-search default
 * hotkey — browser :1420.
 * Run: node .calibration/r185-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 185 additions" (G3 partial calibration).
 *
 * The matrix marked these partial (settings switch exists, no command). R185 adds
 * commands that flip the existing appearance setting via its setter (pure display:
 * line-number gutter / line width / spellcheck attr / ribbon — no doc/vault write),
 * and calibrates app:show-search to Obsidian's default Mod+Shift+F.
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
await page.evaluate(() => localStorage.setItem("geode.locale", "en"));
await page.reload();
await page.waitForFunction(() => !!window.geode, null, { timeout: 15000 });
await page.evaluate(() => window.geode.registerPlugin({ id: "r185", name: "r185", onload(app) { window.__app = app; } }));
await page.waitForFunction(() => !!window.__app, null, { timeout: 5000 });

const app = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = (id) => app(([cid]) => window.__app.commands.execute(cid), [id]);
const ls = (k) => app(([key]) => localStorage.getItem(key), [k]);

// def = the setting's default boolean (localStorage absent → default). Compare the
// VALUE (null≡default), not the raw string (null vs stringified default differ).
const TOGGLES = [
  { id: "editor:toggle-line-numbers", key: "geode.showLineNumbers", def: false },
  { id: "editor:toggle-readable-line-length", key: "geode.readableLineLength", def: true },
  { id: "editor:toggle-spellcheck", key: "geode.spellcheck", def: true },
  { id: "app:toggle-ribbon", key: "geode.showRibbon", def: true },
];
const valOf = (raw, def) => (raw === null ? def : raw === "true");

console.log("— all 4 toggle commands registered + names resolve —");
const reg = await app(([ids]) => ids.map((id) => {
  const c = window.__app.commands.list().find((x) => x.id === id);
  return { id, present: !!c, name: c ? c.name() : null };
}), [TOGGLES.map((t) => t.id)]);
for (const r of reg) {
  ok(`${r.id} registered`, r.present);
  ok(`${r.id} name resolves (not raw key)`, !!r.name && !r.name.startsWith("cmd."), r.name);
}

console.log("— show-search calibrated to Mod+Shift+F (Obsidian default) —");
ok("app:show-search effective hotkey = Mod+Shift+F", await app(() =>
  window.__app.commands.getEffectiveHotkey("app:show-search") === "Mod+Shift+F"),
  await app(() => window.__app.commands.getEffectiveHotkey("app:show-search")));

console.log("— each toggle flips its appearance setting (value) + round-trips —");
for (const { id, key, def } of TOGGLES) {
  const before = valOf(await ls(key), def);
  await exec(id);
  await wait(80);
  const after = valOf(await ls(key), def);
  ok(`${id} flips ${key} (${before} → ${after})`, after === !before);
  await exec(id);
  await wait(80);
  const back = valOf(await ls(key), def);
  ok(`${id} round-trips back to ${before}`, back === before, `back=${back}`);
}

console.log("— toggles need no active file (run on graph tab) —");
await app(() => window.__app.workspace.openGraph());
await wait(120);
const rb = await ls("geode.showRibbon");
await exec("app:toggle-ribbon");
await wait(80);
ok("app:toggle-ribbon works with no active file", (await ls("geode.showRibbon")) !== rb);
await exec("app:toggle-ribbon"); // restore
await wait(60);

ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR185: ${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
