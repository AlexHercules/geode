/**
 * R79 desktop probe — verifies resolveTheme (truth table) + accent apply on the
 * REAL Tauri / WKWebView build via window.__geodeAppearance (synchronous setProperty
 * + read, recorded immediately — App-Nap-safe). The settings DOM + live media
 * follow are browser-E2E only (r79-e2e). Run: node .calibration/r79-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r79-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r79-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "n.md"), "# n\n");

const probe = `module.exports = {
  id: "r79-probe", name: "r79-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r79-results.md", b).catch(() => app.vault.modify("r79-results.md", b).catch(() => {})); };
    try {
      const A = (globalThis).__geodeAppearance;
      rec("present", typeof A?.resolveTheme === "function");
      rec("rt_dark", A.resolveTheme("dark", false));
      rec("rt_light", A.resolveTheme("light", true));
      rec("rt_sys_dark", A.resolveTheme("system", true));
      rec("rt_sys_light", A.resolveTheme("system", false));
      A.setAccent("#ff0000");
      rec("accent_set", document.documentElement.style.getPropertyValue("--accent").trim());
      A.setAccent("bad");
      rec("accent_invalid", document.documentElement.style.getPropertyValue("--accent").trim());
      A.setAccent("#00ff00");
      A.setAccent("");
      rec("accent_reset", document.documentElement.style.getPropertyValue("--accent").trim());
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r79-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
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

console.log("— appearance on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeAppearance.resolveTheme present", data.present === true);
ok("resolveTheme(dark)→dark, (light)→light", data.rt_dark === "dark" && data.rt_light === "light");
ok("resolveTheme(system,dark)→dark, (system,light)→light", data.rt_sys_dark === "dark" && data.rt_sys_light === "light");
ok("setAccent(#ff0000) → --accent #ff0000", data.accent_set === "#ff0000", JSON.stringify(data.accent_set));
ok("invalid color → --accent dropped", data.accent_invalid === "", JSON.stringify(data.accent_invalid));
ok("reset → --accent removed", data.accent_reset === "", JSON.stringify(data.accent_reset));

console.log(`\nR79 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
