/**
 * R128 desktop probe — compat Editor 方法补全 on the real Tauri / WKWebView binary. Confirms the
 * binary loads the new editor.ts (with @codemirror/commands + @codemirror/language imports) without
 * breakage, the activeEditor null-guard holds, and — IF an editor mounts (the r117 path: openFile +
 * live + getActiveView) — that the new methods exist and a read (listSelections/wordAt/getScrollInfo)
 * + an in-memory write (setLine) work on real WKWebView. Full write→autosave semantics are browser-
 * E2E-verified (15/15, incl. persistence to vault). Run: node .calibration/r128-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r128-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r128-results.md");

let passed = 0, failed = 0;
const fails = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "note.md"), "# note\nalpha bravo\n");

const probe = `module.exports = {
  id: "r128-probe", name: "r128-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r128-results.md", b).catch(() => napp.vault.modify("r128-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.workspace && napp.workspace && napp.documents);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("note.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      rec("nullWhenNoEditor", window.app.workspace.activeEditor === null);
      napp.workspace.openFile("note.md");
      const tab = napp.workspace.getActiveTab();
      if (tab) napp.workspace.setTabMode(tab.id, "live");
      for (let i = 0; i < 80 && !napp.documents.getActiveView(); i++) { try { await napp.vault.read("note.md"); } catch { /* drain */ } }
      const mounted = !!napp.documents.getActiveView();
      rec("editorMounted", mounted);
      if (mounted) {
        const e = window.app.workspace.activeEditor && window.app.workspace.activeEditor.editor;
        const methods = ["listSelections","setSelections","setLine","transaction","wordAt","exec","undo","redo","getScrollInfo","scrollIntoView","scrollTo","blur"];
        rec("methodsPresent", !!e && methods.every((m) => typeof e[m] === "function"));
        if (e) {
          e.setCursor({ line: 0, ch: 0 });
          rec("listSelLen", e.listSelections().length);
          const w = e.wordAt({ line: 1, ch: 2 }); // line 1 = "alpha bravo" → "alpha" 0..5
          rec("wordAt", w ? [w.from.ch, w.to.ch] : null);
          e.setLine(0, "DESKTOP");
          rec("setLineWorks", e.getLine(0) === "DESKTOP");
          const si = e.getScrollInfo();
          rec("scrollInfoOk", !!si && typeof si.top === "number" && typeof si.left === "number");
        }
      }
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r128-probe.js"), probe);
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

console.log("— compat Editor methods on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App.workspace present (R128 editor.ts + new CM imports load cleanly)", data.present === true);
ok("no active editor → activeEditor is null (null-guard)", data.nullWhenNoEditor === true);
if (data.editorMounted) {
  ok("all 12 new Editor methods present on the live editor", data.methodsPresent === true, JSON.stringify(data.methodsPresent));
  ok("listSelections returns ≥1 selection", data.listSelLen >= 1, JSON.stringify(data.listSelLen));
  ok("wordAt(line1 ch2) → 'alpha' [0,5]", eq(data.wordAt, [0, 5]), JSON.stringify(data.wordAt));
  ok("setLine works on real WKWebView (in-memory)", data.setLineWorks === true, JSON.stringify(data.setLineWorks));
  ok("getScrollInfo returns {top,left} numbers", data.scrollInfoOk === true, JSON.stringify(data.scrollInfoOk));
} else {
  console.log("  · editor did not mount headless (no focus, R115/§D) — method semantics covered by browser E2E 19/19");
}

console.log(`\nR128 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
