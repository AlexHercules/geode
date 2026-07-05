/**
 * R263 Step-0 probe #2 — does real Templater 2.23.0 LOAD in Geode, and can a basic template expand?
 * Its requires: obsidian + @codemirror/* (shimmed) + child_process + util (Node built-ins, used by
 * tp.system/user-scripts). If those are EAGER, onload fails (hostRequire throws) → the 崩哪补哪 fix is
 * Geode stubs (zero new dep). If LAZY, it loads and basic tp.date/tp.file templating works.
 * Run: node .calibration/r263-probe2.mjs   (dev server up + .calibration/templater/)
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const TP_DIR = join(__dir, "templater");
const BASE_URL = "http://localhost:1420";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(join(TP_DIR, "main.js"))) { console.log("Templater bundle missing — abort."); process.exit(2); }

const mainJs = readFileSync(join(TP_DIR, "main.js"), "utf8");
const manifestJson = readFileSync(join(TP_DIR, "manifest.json"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });

await page.addInitScript(({ mainJs, manifestJson }) => {
  window.__geodeObsidianPlugins = [{ dir: "templater-obsidian", manifestJson, mainJs, stylesCss: null, dataJson: null }];
  window.__geodeObsidianConfig = { "community-plugins.json": '["templater-obsidian"]' };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
}, { mainJs, manifestJson });

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === "templater-obsidian"), null, { timeout: 12000 }).catch(() => {});

const report = await page.evaluate(() => (window.geode.app.obsidianLoadReport.get() ?? []).find((r) => r.id === "templater-obsidian") ?? null);
console.log("Templater load report:", JSON.stringify(report));

if (report?.status !== "enabled") {
  console.log("\n=> Templater did NOT load. lastError surfaces the first 崩哪补哪 blocker (likely require child_process/util).");
  console.log("pageErrors:", pageErrors.slice(0, 4).join("\n  "));
  await browser.close();
  process.exit(0);
}

// loaded — inspect the engine + registered commands
const info = await page.evaluate(() => {
  const cmds = (window.app?.commands?.listCommands?.() ?? window.geode.app.commands.list() ?? []).map((c) => c.id).filter((id) => /templater/i.test(id));
  const p = window.app?.plugins?.plugins?.["templater-obsidian"];
  return { templaterCommands: cmds, hasPlugin: !!p, hasEngine: !!(p && p.templater), engineKeys: p && p.templater ? Object.keys(p.templater).slice(0, 12) : null };
});
console.log("Templater commands:", JSON.stringify(info.templaterCommands));
console.log("plugin/engine:", JSON.stringify({ hasPlugin: info.hasPlugin, hasEngine: info.hasEngine, engineKeys: info.engineKeys }));

// try a basic template expansion via the "replace in active file" command
const expanded = await page.evaluate(async () => {
  const v = window.geode.app.vault;
  try { await v.create("r263-tpl.md", "Year: <% tp.date.now(\"YYYY\") %> Title: <% tp.file.title %>\n"); } catch {}
  window.geode.app.workspace.openFile("r263-tpl.md");
  const t = window.geode.app.workspace.getActiveTab();
  if (t) window.geode.app.workspace.setTabMode(t.id, "source");
  await new Promise((r) => setTimeout(r, 400));
  // find + run a replace-in-file command
  const cmds = window.app.commands.listCommands ? window.app.commands.listCommands() : window.geode.app.commands.list();
  const replace = cmds.find((c) => /replace.*templater|templater.*replace/i.test(c.id) || /replace-in-file/i.test(c.id));
  let ran = null;
  if (replace) { try { window.app.commands.executeCommandById ? window.app.commands.executeCommandById(replace.id) : window.geode.app.commands.execute(replace.id); ran = replace.id; } catch (e) { ran = "ERR:" + e.message; } }
  await new Promise((r) => setTimeout(r, 800));
  const text = await window.geode.app.vault.read("r263-tpl.md").catch(() => "<read-failed>");
  return { ran, text };
});
console.log("\nReplace command ran:", expanded.ran);
console.log("File after expansion:", JSON.stringify(expanded.text));
const ok = !/<%/.test(expanded.text) && /Year: \d{4}/.test(expanded.text);
console.log("=> basic template expanded:", ok ? "YES ✓" : "NO (still has <% or no year)");

console.log("\nTotal pageErrors:", pageErrors.length, pageErrors.slice(0, 3).join(" || "));
await browser.close();
