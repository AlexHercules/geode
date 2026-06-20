/**
 * R129 desktop probe — compat App.loadLocalStorage / saveLocalStorage / isDarkMode on the real Tauri
 * / WKWebView binary. Unlike editor methods (R128), these are App-level + need no focus/mount, so the
 * probe fully exercises them on real WKWebView: JSON round-trip, null-clear, missing→null, vault
 * namespacing, and isDarkMode reads the resident body theme class. Run: node .calibration/r129-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r129-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r129-results.md");

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
  id: "r129-probe", name: "r129-probe",
  onload(napp) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      napp.vault.create("r129-results.md", b).catch(() => napp.vault.modify("r129-results.md", b).catch(() => {})); };
    rec("boot", true);
    void (async () => {
    try {
      const ready = () => !!(window.app && typeof window.app.loadLocalStorage === "function");
      for (let i = 0; i < 80 && !ready(); i++) { try { await napp.vault.read("note.md"); } catch { /* drain */ } }
      rec("present", ready());
      if (!ready()) { rec("done", true); return; }
      const a = window.app;
      a.saveLocalStorage("probe", { v: 7, list: [1, 2] });
      rec("loaded", a.loadLocalStorage("probe"));
      a.saveLocalStorage("probe", null);
      rec("cleared", a.loadLocalStorage("probe"));
      rec("missing", a.loadLocalStorage("nope"));
      a.saveLocalStorage("ns", "x");
      rec("namespaced", localStorage.getItem("geode-ls:" + encodeURIComponent(a.vault.getName()) + ":ns") !== null);
      rec("notBare", localStorage.getItem("ns") === null);
      rec("isDarkType", typeof a.isDarkMode());
      rec("isDarkMatchesBody", a.isDarkMode() === document.body.classList.contains("theme-dark"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
    })();
  }
};
`;
writeFileSync(join(PLUGINS, "r129-probe.js"), probe);
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

console.log("— compat App localStorage + isDarkMode on the real WKWebView binary —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("compat App with loadLocalStorage present", data.present === true);
ok("loadLocalStorage round-trips a deep object on real WKWebView", eq(data.loaded, { v: 7, list: [1, 2] }), JSON.stringify(data.loaded));
ok("saveLocalStorage(key, null) clears → null", data.cleared === null, JSON.stringify(data.cleared));
ok("a missing key → null", data.missing === null, JSON.stringify(data.missing));
ok("keys are vault-namespaced (real WKWebView localStorage)", data.namespaced === true);
ok("NOT stored under the bare key", data.notBare === true);
ok("isDarkMode() returns a boolean", data.isDarkType === "boolean", JSON.stringify(data.isDarkType));
ok("isDarkMode() agrees with the body theme class", data.isDarkMatchesBody === true);

console.log(`\nR129 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
