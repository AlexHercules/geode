/**
 * R81 desktop probe — verifies tabIdsToClose on the REAL Tauri / WKWebView build
 * via window.__geodeTabsToClose (synchronous, App-Nap-safe). The menu DOM is
 * browser-E2E only (r81-e2e). Run: node .calibration/r81-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r81-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r81-results.md");

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
  id: "r81-probe", name: "r81-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r81-results.md", b).catch(() => app.vault.modify("r81-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeTabsToClose;
      rec("present", typeof F === "function");
      const tabs = [{ id: "a" }, { id: "b", pinned: true }, { id: "c" }, { id: "d" }];
      rec("others", F(tabs, "c", "others"));
      rec("right", F(tabs, "c", "right"));
      rec("all", F(tabs, "c", "all"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r81-probe.js"), probe);
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
const eq = (v, exp) => JSON.stringify(v) === JSON.stringify(exp);

console.log("— tabIdsToClose on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeTabsToClose present", data.present === true);
ok("others → a,d (skip target + pinned)", eq(data.others, ["a", "d"]), JSON.stringify(data.others));
ok("right → d (after c, skip pinned)", eq(data.right, ["d"]), JSON.stringify(data.right));
ok("all → a,c,d (skip pinned)", eq(data.all, ["a", "c", "d"]), JSON.stringify(data.all));

console.log(`\nR81 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
