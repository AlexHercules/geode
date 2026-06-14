/**
 * R51 desktop probe — verifies the line-motion CM commands (move/copy line) against
 * the REAL Tauri build via the pure __geodeMotion transform (CM StateCommand on a
 * throwaway EditorState — deterministic, no live view). The live command path
 * (editor:move-line-* on a real CM view) is exercised by the browser E2E.
 *
 * Run: node .calibration/r51-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 51 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r51-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r51-results.md");

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
  id: "r51-probe", name: "r51-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r51-results.md", body).catch(() =>
        app.vault.modify("r51-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const M = (globalThis).__geodeMotion;
      recFlush("present", !!(M && M.moveUp && M.copyDown));
      recFlush("moveUp", M.moveUp("a\\nb\\nc", 2));     // b\\na\\nc
      recFlush("moveDown", M.moveDown("a\\nb\\nc", 2)); // a\\nc\\nb
      recFlush("copyUp", M.copyUp("a\\nb\\nc", 2));     // a\\nb\\nb\\nc
      recFlush("moveUpNoop", M.moveUp("a\\nb\\nc", 0)); // a\\nb\\nc
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r51-probe.js"), probe);
rmSync(RESULTS, { force: true });

console.log(`— launching ${BIN} <vault> —`);
const child = spawn(BIN, [VAULT], { stdio: "ignore", detached: true });

const deadline = Date.now() + 16000;
let raw = null;
while (Date.now() < deadline) {
  if (existsSync(RESULTS)) { raw = readFileSync(RESULTS, "utf8"); if (raw.includes("done=")) break; }
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
const J = (v) => JSON.stringify(v);

console.log("— __geodeMotion CM line commands on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeMotion present", data.present === true);
ok("moveUp → b\\na\\nc", data.moveUp === "b\na\nc", J(data.moveUp));
ok("moveDown → a\\nc\\nb", data.moveDown === "a\nc\nb", J(data.moveDown));
ok("copyUp → a\\nb\\nb\\nc", data.copyUp === "a\nb\nb\nc", J(data.copyUp));
ok("moveUp on first line is a no-op", data.moveUpNoop === "a\nb\nc", J(data.moveUpNoop));

console.log(`\nR51 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
