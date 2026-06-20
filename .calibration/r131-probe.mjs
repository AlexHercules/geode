/**
 * R131 desktop probe — compat workspace.on('editor-menu') on the real Tauri / WKWebView binary.
 * Registers an editor-menu handler, opens an editor, and (IF it mounts) dispatches a synthetic
 * contextmenu on .cm-content → asserts the compat Menu shows the plugin item + the handler got the
 * editor/info on real WKWebView. If the editor doesn't mount (headless no-focus, R115/§D), falls
 * back to surface checks (binary loads the new editorMenu extension + workspace.on registerable).
 * Run: node .calibration/r131-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r131-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r131-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "note.md"), "alpha bravo\nsecond line\n");

const probe = `module.exports = {
  id: "r131-probe", name: "r131-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r131-results.md", b).catch(() => napp.vault.modify("r131-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.workspace && napp.workspace && napp.documents);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("note.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      window.__emFired = null; window.__emInfo = null; window.__emEditorOk = false;
      rec("onRegisterable", typeof window.app.workspace.on === "function");
      window.app.workspace.on("editor-menu", (menu, editor, info) => {
        window.__emInfo = info && info.file && info.file.path;
        window.__emEditorOk = !!(editor && typeof editor.getValue === "function");
        menu.addItem((item) => item.setTitle("Probe EM").setIcon("star").onClick(() => { window.__emFired = "fired:" + (info && info.file && info.file.path); }));
      });
      napp.workspace.openFile("note.md");
      const tab = napp.workspace.getActiveTab();
      if (tab) napp.workspace.setTabMode(tab.id, "live");
      for (let i = 0; i < 80 && !napp.documents.getActiveView(); i++) { try { await napp.vault.read("note.md"); } catch { /* drain */ } }
      const mounted = !!napp.documents.getActiveView();
      rec("editorMounted", mounted);
      if (mounted) {
        const cm = document.querySelector(".cm-content");
        if (cm) {
          cm.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
          const menuEl = document.querySelector('[data-testid="compat-menu"]');
          rec("menuShown", !!menuEl);
          const itemEl = menuEl && menuEl.querySelector('[data-testid="compat-menu-item"]');
          rec("itemText", itemEl ? itemEl.textContent.trim() : null);
          rec("emInfo", window.__emInfo);
          rec("emEditorOk", window.__emEditorOk);
          if (itemEl) { itemEl.click(); rec("fired", window.__emFired); }
        }
      }
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r131-probe.js"), probe);
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

console.log("— compat editor-menu on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App present (R131 editorMenu extension loads cleanly)", data.present === true);
ok("workspace.on is registerable", data.onRegisterable === true);
if (data.editorMounted && data.menuShown !== undefined) {
  ok("synthetic contextmenu → compat Menu shown on real WKWebView", data.menuShown === true, JSON.stringify(data.menuShown));
  ok("menu shows the contributed item 'Probe EM'", data.itemText === "Probe EM", JSON.stringify(data.itemText));
  ok("handler got the active MarkdownView info (note.md)", data.emInfo === "note.md", JSON.stringify(data.emInfo));
  ok("handler got a usable Editor", data.emEditorOk === true);
  ok("clicking the item fires its onClick (real WKWebView)", data.fired === "fired:note.md", JSON.stringify(data.fired));
} else {
  console.log("  · editor did not mount headless (no focus, R115/§D) — full editor-menu fire covered by browser E2E 7/7");
}

console.log(`\nR131 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
