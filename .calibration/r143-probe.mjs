/**
 * R143 desktop probe — verifies the global "Match case" toggle at the core layer on the REAL
 * Tauri/WKWebView build via the 3-arg __geodeSearchQuery(query, input, defaultCaseSensitive)
 * (pure parseSearchQuery + evaluateSearch on synthetic input — deterministic, App-Nap-safe).
 *
 * Run: node .calibration/r143-probe.mjs   (release binary must be built WITH R143)
 * Contract: docs/ARCHITECTURE.md "Round 143 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r143-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r143-results.md");

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
  id: "r143-probe", name: "r143-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r143-results.md", b).catch(() => app.vault.modify("r143-results.md", b).catch(() => {})); };
    try {
      const S = (globalThis).__geodeSearchQuery;
      rec("present", typeof S === "function");
      // default-mode term follows the global flag
      rec("defaultOff", S("Hello", { content: "hello world" }, false));
      rec("defaultOn", S("Hello", { content: "hello world" }, true));
      // explicit operators always win over the global flag
      rec("matchCaseWins", S("match-case:Hello", { content: "hello" }, false));
      rec("ignoreCaseWins", S("ignore-case:Hello", { content: "hello" }, true));
      // flag reaches tag + property terms
      rec("tagOff", S("tag:work", { tags: ["Work"] }, false));
      rec("tagOn", S("tag:work", { tags: ["Work"] }, true));
      rec("propOff", S("[Status:done]", { frontmatter: { Status: "Done" } }, false));
      rec("propOn", S("[Status:done]", { frontmatter: { Status: "Done" } }, true));
      // regex keeps its own /i semantics, unaffected by the global flag
      rec("regexOff", S("/Hello/", { content: "hello" }, false));
      rec("regexOn", S("/Hello/", { content: "hello" }, true));
      rec("regexI", S("/hello/i", { content: "HELLO" }, true));
      // 2-arg back-compat (R68 callers) still defaults to insensitive
      rec("backCompat", S("Hello", { content: "hello" }));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r143-probe.js"), probe);
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
const J = (v) => JSON.stringify(v);

console.log("— global Match-case toggle on real WKWebView (core layer) —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeSearchQuery (3-arg) present", data.present === true);
ok("default term insensitive when flag OFF", data.defaultOff === true, J(data.defaultOff));
ok("default term sensitive when flag ON", data.defaultOn === false, J(data.defaultOn));
ok("match-case: stays sensitive even with flag OFF", data.matchCaseWins === false, J(data.matchCaseWins));
ok("ignore-case: stays insensitive even with flag ON", data.ignoreCaseWins === true, J(data.ignoreCaseWins));
ok("tag term follows flag (OFF → match)", data.tagOff === true, J(data.tagOff));
ok("tag term follows flag (ON → no match)", data.tagOn === false, J(data.tagOn));
ok("property term follows flag (OFF → match)", data.propOff === true, J(data.propOff));
ok("property term follows flag (ON → no match)", data.propOn === false, J(data.propOn));
ok("regex unaffected by flag OFF", data.regexOff === false, J(data.regexOff));
ok("regex unaffected by flag ON", data.regexOn === false, J(data.regexOn));
ok("regex /i flag still works", data.regexI === true, J(data.regexI));
ok("2-arg back-compat defaults insensitive", data.backCompat === true, J(data.backCompat));

console.log(`\nR143 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
