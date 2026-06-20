/**
 * R130 desktop probe — compat workspace.on('file-menu') DATA PATH on the real Tauri / WKWebView
 * binary: register a file-menu handler, then drive the core provider via collectFileMenu and verify
 * the contribution (title/icon) + the onClick closure fire on real WKWebView. The Explorer UI
 * (right-click → render → click) is browser-E2E-verified (12/12); a headless WKWebView has no CDP
 * to drive a real right-click, so the probe covers the platform-agnostic bridge on the real binary.
 * Run: node .calibration/r130-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r130-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r130-results.md");

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
writeFileSync(join(VAULT, "note.md"), "# note\n");

const probe = `module.exports = {
  id: "r130-probe", name: "r130-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r130-results.md", b).catch(() => napp.vault.modify("r130-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && window.app.workspace && window.app._geode && window.app._geode.plugins && napp.vault);
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("note.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      window.__r130 = null;
      window.app.workspace.on("file-menu", (menu, file, source) => {
        window.__r130src = source; window.__r130file = file && file.path;
        menu.addItem((item) => item.setTitle("Probe Item").setIcon("star").onClick(() => { window.__r130 = "clicked:" + (file && file.path); }));
        menu.addItem((item) => item.setTitle("")); // dropped
      });
      const items = window.app._geode.plugins.collectFileMenu({ path: "note.md", isFolder: false, source: "file-explorer-context-menu" });
      rec("titles", items.map((i) => i.title));
      rec("icons", items.map((i) => i.icon === undefined ? null : i.icon));
      rec("src", window.__r130src);
      rec("file", window.__r130file);
      if (items[0]) items[0].onClick();
      rec("fired", window.__r130);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r130-probe.js"), probe);
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

console.log("— compat file-menu bridge (collectFileMenu data path) on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App + core plugins registry present", data.present === true);
ok("empty-title item dropped → 1 contributed item ['Probe Item']", eq(data.titles, ["Probe Item"]), JSON.stringify(data.titles));
ok("icon captured ['star']", eq(data.icons, ["star"]), JSON.stringify(data.icons));
ok("handler got source = 'file-explorer-context-menu'", data.src === "file-explorer-context-menu", JSON.stringify(data.src));
ok("handler got the right TFile (note.md)", data.file === "note.md", JSON.stringify(data.file));
ok("the item's onClick closure fires with the captured file (real WKWebView)", data.fired === "clicked:note.md", JSON.stringify(data.fired));

console.log(`\nR130 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
