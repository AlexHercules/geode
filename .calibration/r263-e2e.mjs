/**
 * R263 — real Templater 2.23.0 (the #2 Obsidian plugin) loads + executes templates in Geode.
 * Unblocked by catching the obsidian shim up to the newer-app (~1.13) API surface Templater needs:
 *   ConfirmationModal / SettingPage / SettingGroup / FileSystemAdapter / getFrontMatterInfo /
 *   resolveSubpath / Plugin.registerCliHandler / SettingTab.update + an expanded CM5 stub whose
 *   getMode returns CM5's null-mode ("name":"null") so a CM5-mode plugin gracefully SKIPS syntax
 *   highlighting instead of building a StreamLanguage that crashes the editor.
 * Templater (GPL) bundle is NOT committed — fetch to .calibration/templater/ to run (else skipped):
 *   curl -sL -o .calibration/templater/main.js https://github.com/SilentVoid13/Templater/releases/latest/download/main.js
 *   curl -sL -o .calibration/templater/manifest.json https://github.com/SilentVoid13/Templater/releases/latest/download/manifest.json
 * Run: node .calibration/r263-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 263 additions".
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const TP_DIR = join(__dir, "templater");
const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const browser = await chromium.launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(join(TP_DIR, "main.js"))) {
  console.log("R263 SKIPPED: Templater bundle not at .calibration/templater/ (see header to fetch).");
  await browser.close();
  process.exit(0);
}

console.log("— real Templater 2.23 loads + executes templates in Geode —");
const mainJs = readFileSync(join(TP_DIR, "main.js"), "utf8");
const manifestJson = readFileSync(join(TP_DIR, "manifest.json"), "utf8");
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
await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === "templater-obsidian"), null, { timeout: 12000 });

const report = await page.evaluate(() => (window.geode.app.obsidianLoadReport.get() ?? []).find((r) => r.id === "templater-obsidian"));
ok("Templater 2.23 onload completed — status=enabled (newer-API shim + CM5 null-mode unblocked it)", report?.status === "enabled", JSON.stringify(report));

const cmds = await page.evaluate(() => (window.app.commands.listCommands?.() ?? []).map((c) => c.id).filter((id) => /templater/i.test(id)));
ok("Templater registered its commands (replace-in-file + insert)", cmds.includes("templater-obsidian:replace-in-file-templater") && cmds.includes("templater-obsidian:insert-templater"), JSON.stringify(cmds));

// run a basic template through the real engine, then read it back (data-safety: editor write → autosave)
async function expand(fname, body) {
  await page.evaluate(async ({ fname, body }) => {
    const v = window.geode.app.vault;
    try { await v.create(fname, body); } catch {}
    window.geode.app.workspace.openFile(fname);
    const t = window.geode.app.workspace.getActiveTab();
    if (t) window.geode.app.workspace.setTabMode(t.id, "source");
    await new Promise((r) => setTimeout(r, 300));
    window.app.commands.executeCommandById("templater-obsidian:replace-in-file-templater");
  }, { fname, body });
  await wait(900);
  return page.evaluate((p) => window.geode.app.vault.read(p).catch(() => "<read-failed>"), fname);
}

const basic = await expand("r263-basic.md", 'Year: <% tp.date.now("YYYY") %> | Title: <% tp.file.title %>\n');
ok("tp.date.now(\"YYYY\") expanded to a 4-digit year", /Year: \d{4}\b/.test(basic), JSON.stringify(basic));
ok("tp.file.title expanded to the note basename", /Title: r263-basic\b/.test(basic), JSON.stringify(basic));
ok("no `<%` template markers remain (real engine ran end to end)", !/<%/.test(basic), JSON.stringify(basic));
ok("expansion PERSISTED to disk (Templater editor write → Geode autosave; data-safety)", basic.length > 0 && basic !== "<read-failed>" && /Year:/.test(basic));

// tp.frontmatter exercises getFrontMatterInfo + R262 typed frontmatter (number stays usable)
const fm = await expand("r263-fm.md", "---\ncount: 7\nname: Zed\n---\nCount is <% tp.frontmatter.count %> for <% tp.frontmatter.name %>\n");
ok("tp.frontmatter.count expanded (getFrontMatterInfo + metadataCache frontmatter)", /Count is 7\b/.test(fm), JSON.stringify(fm));
ok("tp.frontmatter.name expanded", /for Zed\b/.test(fm), JSON.stringify(fm));
ok("frontmatter template expansion left the frontmatter block intact", fm.startsWith("---\ncount: 7"), JSON.stringify(fm.slice(0, 30)));

ok("no uncaught page errors across load + 2 template expansions (clean)", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

console.log(`\nR263 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await page.close();
await browser.close();
process.exit(failed === 0 ? 0 : 1);
