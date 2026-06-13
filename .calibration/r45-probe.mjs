/**
 * R45 desktop probe — verifies named-workspace persistence against the REAL Tauri
 * build. The strongest check is the actual file on disk: the in-app probe drives
 * __geodeWorkspaces.save() (store + vault-level → drivable in a backgrounded
 * WKWebView), then the Node runner reads <vault>/.obsidian/workspaces.json ON DISK
 * to prove the named layout was persisted with its pane tree. The Manage-workspaces
 * MODAL + command are React-effect bound (App-Nap §D) → covered by the browser E2E.
 *
 * Run: node .calibration/r45-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 45 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r45-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r45-results.md");
const WS_FILE = join(VAULT, ".obsidian/workspaces.json");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "seed.md"), "# Seed\n");

const probe = `module.exports = {
  id: "r45-probe", name: "r45-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r45-results.md", body).catch(() =>
        app.vault.modify("r45-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const W = (globalThis).__geodeWorkspaces;
      recFlush("present", !!W);
      W.save("probe-ws");                       // fire-and-forget write to .obsidian/workspaces.json
      recFlush("listAfterSave", W.list().join(",")); // store.set is sync → reflects immediately
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r45-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) { raw = readFileSync(RESULTS, "utf8"); if (raw.includes("done=")) break; }
  await new Promise((r) => setTimeout(r, 300));
}
// give the fire-and-forget writeConfig a moment to land on disk after done=
const fileDeadline = Date.now() + 4000;
while (Date.now() < fileDeadline && !existsSync(WS_FILE)) await new Promise((r) => setTimeout(r, 200));
try { process.kill(-child.pid); } catch { /* gone */ }
if (raw === null) { console.error("no result file produced — probe did not run"); process.exit(1); }

const data = {};
for (const line of raw.split("\n")) {
  const i = line.indexOf("=");
  if (i === -1) continue;
  try { data[line.slice(0, i)] = JSON.parse(line.slice(i + 1)); } catch { /* partial */ }
}
const J = (v) => JSON.stringify(v);

console.log("— in-app probe (store truth on real WKWebView) —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeWorkspaces present", data.present === true);
ok("list() includes the saved name after save", typeof data.listAfterSave === "string" && data.listAfterSave.split(",").includes("probe-ws"), J(data.listAfterSave));

console.log("— ON-DISK .obsidian/workspaces.json (the persistence core) —");
ok("workspaces.json written to disk under .obsidian/", existsSync(WS_FILE));
let parsed = null;
try { parsed = existsSync(WS_FILE) ? JSON.parse(readFileSync(WS_FILE, "utf8")) : null; } catch (e) { /* malformed */ }
ok("file parses as JSON with a workspaces object", parsed !== null && typeof parsed.workspaces === "object" && parsed.workspaces !== null);
ok("saved layout 'probe-ws' persisted with its pane tree", !!(parsed && parsed.workspaces && parsed.workspaces["probe-ws"] && parsed.workspaces["probe-ws"].root), J(parsed && parsed.workspaces ? Object.keys(parsed.workspaces) : null));

console.log(`\nR45 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
