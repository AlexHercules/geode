/**
 * R264 — harden the editor against a plugin's inline-query CM6 ViewPlugin.
 * Part A (probe plugin, ALWAYS runs): a ViewPlugin reads `editorInfoField` at its CONSTRUCTION
 *   (before the R260 seeding microtask) — like Dataview. The field must be NON-NULL with an
 *   accessible `.file` (was null → `field.file` crashed: "Cannot read properties of null").
 * Part B (real Dataview, skipped if bundle absent): loading Dataview + opening a note in LIVE
 *   mode with inline code no longer crashes its inline ViewPlugin (editorInfoField non-null +
 *   the tokenClassNodeProp bridge stub) — editor survives, 0 "CodeMirror plugin crashed".
 * Run: node .calibration/r264-e2e.mjs   (dev server up)
 * Contract: docs/ARCHITECTURE.md "Round 264 additions".
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const DV = join(__dir, "dataview");
const BASE_URL = "http://localhost:1420";
let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
}
const browser = await chromium.launch();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Part A: editorInfoField non-null at ViewPlugin construction ----------
console.log("— Part A: editorInfoField is NON-NULL at ViewPlugin construction (.file accessible) —");
{
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.addInitScript(() => {
    const mainJs = [
      "const obs = require('obsidian');",
      "const { ViewPlugin } = require('@codemirror/view');",
      "module.exports = class extends obs.Plugin {",
      "  onload() {",
      "    this.registerEditorExtension(ViewPlugin.fromClass(class {",
      "      constructor(view) {",
      "        const out = window.__r264 = window.__r264 || {};",
      "        try {",
      "          const info = view.state.field(obs.editorInfoField);", // Dataview reads this here
      "          out.nonNull = info != null;",
      "          out.fileNoThrow = (info != null) && (info.file === null || info.file === undefined || !!info.file);", // info.file must not throw
      "          out.hasApp = info != null && !!info.app;",
      "          out.mounted = true;",
      "        } catch (e) { out.err = String(e); out.mounted = true; }",
      "      }",
      "    }));",
      "    window.__r264ready = true;",
      "  }",
      "  onunload() {}",
      "};",
    ].join("\n");
    window.__geodeObsidianPlugins = [{ dir: "r264-probe", manifestJson: JSON.stringify({ id: "r264-probe", name: "R264 Probe", version: "1.0.0", minAppVersion: "0.0.1" }), mainJs, stylesCss: null, dataJson: null }];
    window.__geodeObsidianConfig = { "community-plugins.json": '["r264-probe"]' };
    try { localStorage.setItem("geode.locale", "en"); } catch {}
  });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__r264ready === true, null, { timeout: 8000 });
  // open a note in live mode so an EditorView (with the probe extension) is constructed
  await page.evaluate(async () => {
    await window.geode.app.vault.create("r264a.md", "# A\n\nbody with `= this.file.name` inline.\n").catch(() => {});
    window.geode.app.workspace.openFile("r264a.md");
    const t = window.geode.app.workspace.getActiveTab();
    if (t) window.geode.app.workspace.setTabMode(t.id, "live");
  });
  await page.waitForFunction(() => window.__r264?.mounted === true, null, { timeout: 6000 }).catch(() => {});
  await wait(300);
  const r = await page.evaluate(() => window.__r264 ?? null);
  ok("ViewPlugin saw editorInfoField (mounted)", r?.mounted === true, JSON.stringify(r));
  ok("editorInfoField is NON-NULL at construction (was null → R260 gap)", r?.nonNull === true, JSON.stringify(r));
  ok("reading .file did NOT throw (Dataview's crash path)", r?.fileNoThrow === true && !r?.err, JSON.stringify(r));
  ok("info.app present (faithful MarkdownFileInfo)", r?.hasApp === true, JSON.stringify(r));
  ok("Part A: no page errors / no editor crash", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.close();
}

// ---------- Part B: real Dataview inline ViewPlugin no longer crashes the editor ----------
if (!existsSync(join(DV, "main.js"))) {
  console.log("— Part B SKIPPED: Dataview bundle not at .calibration/dataview/ —");
} else {
  console.log("— Part B: real Dataview — opening a note in LIVE mode no longer crashes inline ViewPlugin —");
  const page = await browser.newPage();
  const crashes = [];
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => { if (/CodeMirror plugin crashed|render crashed/.test(m.text())) crashes.push(m.text().slice(0, 80)); });
  await page.addInitScript(({ mainJs, manifestJson }) => {
    window.__geodeObsidianPlugins = [{ dir: "dataview", manifestJson, mainJs, stylesCss: null, dataJson: null }];
    window.__geodeObsidianConfig = { "community-plugins.json": '["dataview"]' };
    try { localStorage.setItem("geode.locale", "en"); } catch {}
  }, { mainJs: readFileSync(join(DV, "main.js"), "utf8"), manifestJson: readFileSync(join(DV, "manifest.json"), "utf8") });
  await page.goto(BASE_URL);
  await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
  await page.waitForFunction(() => (window.geode?.app?.obsidianLoadReport?.get?.() ?? []).some((r) => r.id === "dataview"), null, { timeout: 12000 });
  await page.evaluate(async () => {
    await window.geode.app.vault.create("r264b.md", "# Note\n\ntext with `= this.file.name` and a `$= dv.current().file.name` inline.\n").catch(() => {});
    window.geode.app.workspace.openFile("r264b.md");
    const t = window.geode.app.workspace.getActiveTab();
    if (t) window.geode.app.workspace.setTabMode(t.id, "live");
  });
  await wait(1500);
  const ed = await page.evaluate(() => {
    const c = document.querySelector(".cm-content");
    return { hasEditor: !!document.querySelector(".cm-editor"), hasContent: !!c, text: c ? c.textContent.slice(0, 30) : null };
  });
  ok("editor renders (Dataview loaded, note open in live mode)", ed.hasEditor && ed.hasContent && /Note/.test(ed.text ?? ""), JSON.stringify(ed));
  ok("ZERO 'CodeMirror plugin crashed' (was 2: editorInfoField.file + tokenClassNodeProp)", crashes.length === 0, crashes.join(" | "));
  ok("Part B: no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  await page.close();
}

console.log(`\nR264 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
