/**
 * R52 desktop probe — verifies the editing CM commands (toggle-comment / indent /
 * unindent / select-line) against the REAL Tauri build via the pure __geodeEdit
 * transform (CM StateCommand on a throwaway EditorState with markdown + %%
 * commentTokens — deterministic, no live view). The live command + Mod+/ keystroke
 * paths are exercised by the browser E2E.
 *
 * Run: node .calibration/r52-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 52 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r52-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r52-results.md");

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
  id: "r52-probe", name: "r52-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r52-results.md", body).catch(() =>
        app.vault.modify("r52-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const E = (globalThis).__geodeEdit;
      recFlush("present", !!(E && E.toggleComment && E.indent && E.selectLine));
      recFlush("comment", E.toggleComment("hello", 0, 5).doc);        // %% hello %%
      recFlush("uncomment", E.toggleComment("%% hello %%", 0, 11).doc); // hello
      recFlush("indent", E.indent("abc", 0).doc);                     // (2 spaces)abc
      recFlush("unindent", E.unindent("  abc", 2).doc);               // abc
      const sl = E.selectLine("a\\nb\\nc", 2);
      recFlush("selectLine", sl.from + "," + sl.to);                  // 2,4
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r52-probe.js"), probe);
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

console.log("— __geodeEdit CM editing commands on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeEdit present", data.present === true);
ok("toggle-comment → %% hello %%", data.comment === "%% hello %%", J(data.comment));
ok("toggle-comment uncomment → hello", data.uncomment === "hello", J(data.uncomment));
ok("indent → 2-space indent", data.indent === "  abc", J(data.indent));
ok("select-line → 2,4 (line + break)", data.selectLine === "2,4", J(data.selectLine));

console.log(`\nR52 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
