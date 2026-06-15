/**
 * R85 desktop probe — verifies sanitizeFontFamily (the CSS-injection guard) on the
 * REAL Tauri / WKWebView build via window.__geodeFontSanitize (synchronous,
 * App-Nap-safe). The settings inputs + applied CSS vars are browser-E2E only
 * (r85-e2e, §D). Run: node .calibration/r85-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r85-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r85-results.md");

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
  id: "r85-probe", name: "r85-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r85-results.md", b).catch(() => app.vault.modify("r85-results.md", b).catch(() => {})); };
    try {
      const S = (globalThis).__geodeFontSanitize;
      rec("present", typeof S === "function");
      rec("plain", S("Inter"));
      rec("collapse", S("  JetBrains   Mono  "));
      rec("injection", S('Foo; } body{display:none} (<x>)'));
      rec("empty", S("   "));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r85-probe.js"), probe);
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

console.log("— sanitizeFontFamily on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("plain name kept", data.plain === "Inter", JSON.stringify(data.plain));
ok("whitespace collapsed", data.collapse === "JetBrains Mono", JSON.stringify(data.collapse));
ok("injection chars stripped", typeof data.injection === "string" && !/[;{}()<>"'\\]/.test(data.injection), JSON.stringify(data.injection));
ok("empty → empty", data.empty === "", JSON.stringify(data.empty));

console.log(`\nR85 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
