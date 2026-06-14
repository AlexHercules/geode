/**
 * R55 desktop probe — verifies live-table GFM detection (findTableRanges) + the reused
 * reading-view render (renderMarkdownToHtml → <table>) against the REAL Tauri build via
 * __geodeTable (deterministic, App-Nap-safe — no live view / block widget). The live
 * block widget + cursor-reveal path is a view behavior exercised by the browser E2E.
 *
 * Run: node .calibration/r55-probe.mjs   (release binary must be built)
 * Contract: docs/ARCHITECTURE.md "Round 55 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r55-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r55-results.md");

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

// DOC = "intro\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\noutro\n"
const probe = `module.exports = {
  id: "r55-probe", name: "r55-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => out.push(k + "=" + JSON.stringify(v));
    const flush = () => {
      const body = out.join("\\n");
      app.vault.create("r55-results.md", body).catch(() =>
        app.vault.modify("r55-results.md", body).catch(() => {}));
    };
    const recFlush = (k, v) => { rec(k, v); flush(); };
    try {
      const T = (globalThis).__geodeTable;
      const DOC = "intro\\n\\n| A | B |\\n|---|---|\\n| 1 | 2 |\\n\\noutro\\n";
      recFlush("present", !!(T && T.ranges && T.renders));
      const rs = T.ranges(DOC);
      recFlush("count", rs.length);
      recFlush("slice", rs[0] ? DOC.slice(rs[0].from, rs[0].to).slice(0, 9) : "");
      recFlush("renders", T.renders("| A | B |\\n|---|---|\\n| 1 | 2 |"));
      recFlush("noTable", T.ranges("just text\\nno pipes\\n").length);
      recFlush("done", true);
    } catch (e) { recFlush("error", String(e)); }
  }
};
`;
writeFileSync(join(PLUGINS, "r55-probe.js"), probe);
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

console.log("— __geodeTable GFM detection + render on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeTable present", data.present === true);
ok("finds exactly one table", data.count === 1, J(data.count));
ok("table range slices to pipe source", data.slice === "| A | B |", J(data.slice));
ok("renderMarkdownToHtml emits <table>", data.renders === true, J(data.renders));
ok("plain paragraph → no table", data.noTable === 0, J(data.noTable));

console.log(`\nR55 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
