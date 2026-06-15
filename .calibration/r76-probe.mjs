/**
 * R76 desktop probe — verifies custom task-state RENDERING on the REAL Tauri /
 * WKWebView build via window.__geodeRenderMarkdown (synchronous, deterministic,
 * App-Nap-safe). Proves the converged TASK_RE emits data-task for non-standard
 * markers and keeps standard [ ]/[x] byte-stable on the real engine.
 * Browser parity: .calibration/r76-e2e.mjs. Run: node .calibration/r76-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r76-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r76-results.md");

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
  id: "r76-probe", name: "r76-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r76-results.md", b).catch(() => app.vault.modify("r76-results.md", b).catch(() => {})); };
    try {
      const R = (globalThis).__geodeRenderMarkdown;
      rec("present", typeof R === "function");
      rec("progress", R("- [/] doing", ""));
      rec("cancel", R("- [-] cancelled", ""));
      rec("defer", R("- [>] later", ""));
      rec("std_todo", R("- [ ] todo", ""));
      rec("std_done", R("- [x] done", ""));
      rec("multi", R("- [ab] not a task", ""));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r76-probe.js"), probe);
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

console.log("— custom task-state render on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeRenderMarkdown present", data.present === true);
ok("[/] → data-task=\"/\" + checkbox, not done", typeof data.progress === "string" && /data-task="\/"/.test(data.progress) && /task-checkbox/.test(data.progress) && !/is-checked/.test(data.progress), data.progress);
ok("[-] → data-task=\"-\"", typeof data.cancel === "string" && /data-task="-"/.test(data.cancel), data.cancel);
ok("[>] → data-task=\"&gt;\" (escaped)", typeof data.defer === "string" && /data-task="&gt;"/.test(data.defer), data.defer);
ok("[ ] → checkbox, NO data-task (byte-stable)", typeof data.std_todo === "string" && /task-checkbox/.test(data.std_todo) && !/data-task/.test(data.std_todo), data.std_todo);
ok("[x] → checked + is-checked, NO data-task", typeof data.std_done === "string" && /checked>/.test(data.std_done) && /is-checked/.test(data.std_done) && !/data-task/.test(data.std_done), data.std_done);
ok("[ab] (multi-char) → NOT a checkbox", typeof data.multi === "string" && !/task-checkbox/.test(data.multi), data.multi);

console.log(`\nR76 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
