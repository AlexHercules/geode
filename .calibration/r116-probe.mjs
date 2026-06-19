/**
 * R116 desktop probe — exercises compat MarkdownView.getMode/getViewData on the real Tauri /
 * WKWebView binary. The compat MarkdownView is built over the editor `documents.getActiveView()`
 * tracks (set on CM focus). The probe opens a note, and IF an editor view becomes active it asserts
 * getMode()==="source" + getViewData() returns the source; it also asserts the null-guard (no active
 * editor → null MarkdownView) which works regardless of focus. Run: node .calibration/r116-probe.mjs
 *
 * §D / R115: native onload is fire-and-forget (avoids loadObsidianPlugins deadlock) + IPC-polls.
 * window.app = the compat App (getMode/getViewData live here); napp = native (workspace/documents).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r116-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r116-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
const CONTENT = "# note\nalpha\nbeta\n";
writeFileSync(join(VAULT, "note.md"), CONTENT);

const probe = `module.exports = {
  id: "r116-probe", name: "r116-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r116-results.md", b).catch(() => napp.vault.modify("r116-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.workspace && napp.workspace && napp.documents);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("note.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      // null-guard: no active editor yet → compat active MarkdownView is null (platform-independent)
      rec("nullWhenNoEditor", window.app.workspace.activeLeaf.view === null);
      // try to bring up an editor view
      napp.workspace.openFile("note.md");
      const tab = napp.workspace.getActiveTab();
      if (tab) napp.workspace.setTabMode(tab.id, "live");
      const mv = () => window.app.workspace.activeLeaf.view;
      for (let i = 0; i < 80 && !napp.documents.getActiveView(); i++) { try { await napp.vault.read("note.md"); } catch { /* drain */ } }
      const mounted = !!napp.documents.getActiveView();
      rec("editorMounted", mounted);
      if (mounted) {
        const v = mv();
        rec("getMode", v && v.getMode());
        rec("getViewData", v && v.getViewData());
      }
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r116-probe.js"), probe);
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

console.log("— compat MarkdownView on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App.workspace + MarkdownView path present", data.present === true);
ok("no active editor → active MarkdownView is null (makeActiveMarkdownView null-guard)", data.nullWhenNoEditor === true);
// the editor-mount path is best-effort on a headless WKWebView (no focus → getActiveView may stay
// null, R115). When it DOES mount, verify the semantics; otherwise the full getMode/getViewData
// behavior is covered by the browser E2E (9/9) over the platform-identical code.
if (data.editorMounted) {
  ok("getMode() → 'source' over a real editor", data.getMode === "source", JSON.stringify(data.getMode));
  ok("getViewData() returns the editor source", typeof data.getViewData === "string" && data.getViewData.includes("alpha"), JSON.stringify(data.getViewData));
} else {
  console.log("  · editor did not mount headless (no focus, R115/§D) — getMode/getViewData semantics covered by browser E2E 9/9");
}

console.log(`\nR116 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
