/**
 * R260 — obsidian CM6 editor StateFields (editorInfoField / editorEditorField /
 * editorLivePreviewField + editorViewField alias). A real obsidian plugin registers a
 * CM6 ViewPlugin (via Plugin.registerEditorExtension) that reads the three fields from
 * `view.state.field(...)` — exactly how Dataview/decoration plugins use them — and writes
 * the results to a testid div. Asserts: editorInfoField carries the live file + app,
 * editorEditorField IS the view, editorLivePreviewField is true in live preview and flips
 * to false on a live→source mode switch (reactive, via the mode-compartment facet).
 * The fields are populated by an effect-only dispatch (no doc change → no autosave, 底线①).
 * Run: node .calibration/r260-e2e.mjs   (dev server must be up)
 * Contract: docs/ARCHITECTURE.md "Round 260 additions".
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

// a real obsidian plugin that registers a CM6 ViewPlugin reading the R260 StateFields
await page.addInitScript(() => {
  const mainJs = [
    "const obs = require('obsidian');",
    "const cmView = require('@codemirror/view');",
    "module.exports = class extends obs.Plugin {",
    "  onload() {",
    "    this.registerEditorExtension(cmView.ViewPlugin.fromClass(class {",
    "      update(u) {",
    "        const info = u.view.state.field(obs.editorInfoField, false);",
    "        const ed = u.view.state.field(obs.editorEditorField, false);",
    "        const lp = u.view.state.field(obs.editorLivePreviewField, false);",
    "        const aliasSame = obs.editorViewField === obs.editorInfoField;",
    "        const out = {",
    "          infoNotNull: !!info,",
    "          filePath: info && info.file ? info.file.path : null,",
    "          appOk: info ? !!info.app : false,",
    "          editorIsObsEditor: info ? (info.editor && typeof info.editor.getValue === 'function') : false,",
    "          editorFieldIsView: ed === u.view,",
    "          livePreview: lp,",
    "          aliasSame: aliasSame,",
    "        };",
    "        let el = document.querySelector('[data-testid=\"r260-fields\"]');",
    "        if (!el) { el = document.createElement('div'); el.setAttribute('data-testid','r260-fields'); document.body.appendChild(el); }",
    "        el.textContent = JSON.stringify(out);",
    "      }",
    "    }));",
    "    window.__r260onload = true;",
    "  }",
    "  onunload() {}",
    "};",
  ].join("\n");
  window.__geodeObsidianPlugins = [
    { dir: "r260-test", manifestJson: JSON.stringify({ id: "r260-test", name: "R260 Test", version: "1.0.0", minAppVersion: "0.0.1" }), mainJs, stylesCss: null, dataJson: null },
  ];
  window.__geodeObsidianConfig = { "community-plugins.json": '["r260-test"]' };
  try { localStorage.setItem("geode.locale", "en"); } catch {}
});

await page.goto(BASE_URL);
await page.waitForFunction(() => !!window.geode && !!window.app, null, { timeout: 15000 });
await page.waitForFunction(() => window.__r260onload === true, null, { timeout: 8000 });

const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fields = () => ev(() => {
  const el = document.querySelector('[data-testid="r260-fields"]');
  try { return el ? JSON.parse(el.textContent) : null; } catch { return null; }
});

console.log("— open a note in LIVE mode: the plugin's CM6 extension reads the StateFields —");
await ev(async () => {
  try { await window.geode.app.vault.create("ext1.md", "alpha bravo charlie\n"); } catch { /* exists */ }
  window.geode.app.workspace.openFile("ext1.md");
});
await wait(200);
await ev(() => { const t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "live"); });
await page.waitForSelector(".cm-content", { timeout: 5000 });
await page.click(".cm-content");
// the fields are seeded by an effect-only microtask dispatch after view construction;
// wait for the populating transaction to have fired the plugin's update()
await page.waitForFunction(() => {
  const el = document.querySelector('[data-testid="r260-fields"]');
  try { return el && JSON.parse(el.textContent).infoNotNull === true; } catch { return false; }
}, null, { timeout: 5000 });

const live = await fields();
ok("editorInfoField is non-null (populated)", live?.infoNotNull === true, JSON.stringify(live));
ok("editorInfoField.file is the live file (ext1.md)", live?.filePath === "ext1.md", JSON.stringify(live));
ok("editorInfoField.app is present", live?.appOk === true);
ok("editorInfoField.editor is an obsidian Editor (has getValue)", live?.editorIsObsEditor === true);
ok("editorEditorField IS the EditorView", live?.editorFieldIsView === true);
ok("editorLivePreviewField is TRUE in live mode", live?.livePreview === true, JSON.stringify(live));
ok("editorViewField === editorInfoField (deprecated alias)", live?.aliasSame === true);

console.log("— switch to SOURCE mode: editorLivePreviewField flips to false (reactive) —");
await ev(() => { const t = window.geode.app.workspace.getActiveTab(); if (t) window.geode.app.workspace.setTabMode(t.id, "source"); });
await page.waitForSelector(".cm-content", { timeout: 5000 });
await page.click(".cm-content");
await wait(300);
const src = await fields();
ok("editorLivePreviewField is FALSE in source mode (mode-compartment facet flipped)", src?.livePreview === false, JSON.stringify(src));
ok("editorInfoField still resolves the file after mode switch", src?.filePath === "ext1.md", JSON.stringify(src));
ok("editorEditorField still IS the view after mode switch", src?.editorFieldIsView === true);

console.log("— data-safety: the field-populating dispatch did NOT dirty/edit the doc —");
ok("doc unchanged on disk (effect-only seed, no autosave)", (await ev(() => window.geode.app.vault.read("ext1.md"))) === "alpha bravo charlie\n");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));

console.log(`\nR260 E2E: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
await browser.close();
process.exit(failed === 0 ? 0 : 1);
