/**
 * R117 desktop probe — exercises compat workspace.activeEditor on the real Tauri / WKWebView
 * binary. activeEditor is a live getter over makeActiveMarkdownView (the editor documents.getActiveView
 * tracks). The probe asserts the null-guard (no active editor → activeEditor null, platform-independent)
 * and, IF an editor view becomes active, that activeEditor.file/.editor are populated. The full live
 * semantics are covered by the browser E2E (9/9); per §D/R115 a headless WKWebView won't mount/focus an
 * editor (getActiveView stays null). Run: node .calibration/r117-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r117-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r117-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "note.md"), "# note\nalpha\n");

const probe = `module.exports = {
  id: "r117-probe", name: "r117-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r117-results.md", b).catch(() => napp.vault.modify("r117-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.workspace && napp.workspace && napp.documents);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("note.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      rec("hasGetter", "activeEditor" in window.app.workspace);
      // null-guard: no active editor yet → activeEditor is null (platform-independent)
      rec("nullWhenNoEditor", window.app.workspace.activeEditor === null);
      napp.workspace.openFile("note.md");
      const tab = napp.workspace.getActiveTab();
      if (tab) napp.workspace.setTabMode(tab.id, "live");
      for (let i = 0; i < 80 && !napp.documents.getActiveView(); i++) { try { await napp.vault.read("note.md"); } catch { /* drain */ } }
      const mounted = !!napp.documents.getActiveView();
      rec("editorMounted", mounted);
      if (mounted) {
        const ae = window.app.workspace.activeEditor;
        rec("file", ae && ae.file && ae.file.path);
        rec("hasEditor", !!(ae && ae.editor && typeof ae.editor.getValue === "function"));
        rec("appOk", !!(ae && ae.app));
      }
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r117-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 30000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) { raw = readFileSync(RESULTS, "utf8"); if (raw.includes("done=true")) break; }
  await new Promise((r) => setTimeout(r, 300));
}
try { process.kill(-child.pid); } catch { /* gone */ }
if (raw === null) { console.error("no result file produced — probe did not run"); process.exit(1); }

const data = {};
for (const line of raw.split("\n")) {
  const i = line.indexOf("=");
  if (i === -1) continue;
  try { data[line.slice(0, i)] = JSON.parse(line.slice(i + 1)); } catch { /* partial */ }
}

console.log("— compat workspace.activeEditor on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App.workspace present", data.present === true);
ok("activeEditor getter is defined on the workspace", data.hasGetter === true);
ok("no active editor → activeEditor is null (makeActiveMarkdownView null-guard)", data.nullWhenNoEditor === true);
if (data.editorMounted) {
  ok("activeEditor.file is the active TFile", data.file === "note.md", JSON.stringify(data.file));
  ok("activeEditor.editor is a usable Editor", data.hasEditor === true);
  ok("activeEditor.app is present", data.appOk === true);
} else {
  console.log("  · editor did not mount headless (no focus, R115/§D) — activeEditor field semantics covered by browser E2E 9/9");
}

console.log(`\nR117 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
