/**
 * R88 desktop probe — verifies defaultNewTabMode drives workspace.openFile on the
 * REAL Tauri / WKWebView build via window.__geodeNewTabMode (synchronous): a new
 * tab opens in the configured mode. The line-number CM gutter DOM is browser-E2E
 * only (r88-e2e, §D). Run: node .calibration/r88-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r88-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r88-results.md");

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
writeFileSync(join(VAULT, "b.md"), "# b\n");
writeFileSync(join(VAULT, "c.md"), "# c\n");

const probe = `module.exports = {
  id: "r88-probe", name: "r88-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r88-results.md", b).catch(() => app.vault.modify("r88-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeNewTabMode;
      rec("present", typeof F === "function");
      rec("preview", F("preview", "a.md"));
      rec("source", F("source", "b.md"));
      rec("live", F("live", "c.md"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r88-probe.js"), probe);
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

console.log("— defaultNewTabMode → openFile on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("preview default → new tab opens in preview", data.preview === "preview", JSON.stringify(data.preview));
ok("source default → new tab opens in source", data.source === "source", JSON.stringify(data.source));
ok("live default → new tab opens in live", data.live === "live", JSON.stringify(data.live));

console.log(`\nR88 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
