/**
 * R75 desktop probe — verifies runQueryBlock on the REAL Tauri / WKWebView build
 * + real filesystem via window.__geodeQueryBlock (scans the real-fs vault, runs
 * the search engine — App-Nap-safe: result recorded immediately). The rendered
 * result-list DOM (reading + live widget) is browser-E2E only (r75-e2e); WKWebView
 * DOM reads are unreliable under App-Nap (data-safety §D). This proves the real-fs
 * query path on disk. Run: node .calibration/r75-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r75-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r75-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(join(VAULT, "qzz"), { recursive: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "qzz/one.md"), "first note with apple\n");
writeFileSync(join(VAULT, "qzz/two.md"), "second note with apple\n");
writeFileSync(join(VAULT, "qzz/three.md"), "third note no fruit\n");
writeFileSync(join(VAULT, "other.md"), "unrelated\n");

const probe = `module.exports = {
  id: "r75-probe", name: "r75-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r75-results.md", b).catch(() => app.vault.modify("r75-results.md", b).catch(() => {})); };
    try {
      const Q = (globalThis).__geodeQueryBlock;
      rec("present", typeof Q === "function");
      rec("path", await Q("path:qzz"));
      rec("content", await Q("content:apple"));
      rec("none", await Q("path:nope__"));
      rec("error", await Q("(unclosed"));
      rec("empty", await Q(""));
      rec("done", true);
    } catch (e) { rec("error_thrown", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r75-probe.js"), probe);
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

console.log("— runQueryBlock on real WKWebView + real fs —");
ok("error-free probe run", data.error_thrown === undefined, JSON.stringify(data.error_thrown));
ok("__geodeQueryBlock present", data.present === true);
ok("path:qzz → 3 matched files on disk", data.path?.total === 3, JSON.stringify(data.path));
ok("path:qzz paths are the qzz notes (sorted)", JSON.stringify(data.path?.paths) === JSON.stringify(["qzz/one.md", "qzz/three.md", "qzz/two.md"]), JSON.stringify(data.path?.paths));
ok("content:apple → 2 matched files", data.content?.total === 2, JSON.stringify(data.content));
ok("no match → total 0", data.none?.total === 0, JSON.stringify(data.none));
ok("invalid query → error set", typeof data.error?.error === "string" && data.error.error.length > 0, JSON.stringify(data.error));
ok("empty query → total 0, no error", data.empty?.total === 0 && data.empty?.error === undefined, JSON.stringify(data.empty));

console.log(`\nR75 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
