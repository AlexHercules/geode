/**
 * R92 desktop probe — verifies the indentation settings on the REAL Tauri /
 * WKWebView build via window.__geodeIndentConfig (synchronous): the real setters
 * clamp + persist, and indentUnitString derives the exact unit Tab inserts. The
 * live-CM reconfigure (view.state.facet) is browser-E2E only (r92-e2e, §D — the
 * reconfigure rides a React effect). Run: node .calibration/r92-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r92-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r92-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "a.md"), "# a\n");

const probe = `module.exports = {
  id: "r92-probe", name: "r92-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r92-results.md", b).catch(() => app.vault.modify("r92-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeIndentConfig;
      rec("present", typeof F === "function");
      rec("tabsOn", F(4, true));
      rec("spaces4", F(4, false));
      rec("spaces2", F(2, false));
      rec("clampHi", F(99, false).size);
      rec("clampLo", F(0, false).size);
      rec("clampNaN", F(Number.NaN, true).size);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r92-probe.js"), probe);
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

console.log("— indentation settings on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("tabs-on → unit is a tab char", data.tabsOn?.unit === "\t", JSON.stringify(data.tabsOn));
ok("tabs-on → useTabs true, size 4", data.tabsOn?.useTabs === true && data.tabsOn?.size === 4, JSON.stringify(data.tabsOn));
ok("tabs-off size 4 → 4 spaces", data.spaces4?.unit === "    ", JSON.stringify(data.spaces4));
ok("tabs-off size 2 → 2 spaces", data.spaces2?.unit === "  ", JSON.stringify(data.spaces2));
ok("clamp: size 99 → 8", data.clampHi === 8, JSON.stringify(data.clampHi));
ok("clamp: size 0 → 1", data.clampLo === 1, JSON.stringify(data.clampLo));
ok("clamp: NaN → 4", data.clampNaN === 4, JSON.stringify(data.clampNaN));

console.log(`\nR92 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
