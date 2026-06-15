/**
 * R87 desktop probe — verifies the markdown-it `breaks` flip on the REAL Tauri /
 * WKWebView build via window.__geodeRenderMarkdown (synchronous). Default (strict
 * OFF) → single newline becomes <br> (Obsidian default); strict ON → CommonMark
 * join. The settings toggle + reactive reading view are browser-E2E only (§D).
 * Run: node .calibration/r87-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r87-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r87-results.md");

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
  id: "r87-probe", name: "r87-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r87-results.md", b).catch(() => app.vault.modify("r87-results.md", b).catch(() => {})); };
    try {
      const R = (globalThis).__geodeRenderMarkdown;
      rec("present", typeof R === "function");
      const soft = "line one\\nline two";
      rec("defaultBr", R(soft, "", false).includes("<br>"));
      rec("strictNoBr", R(soft, "", true).includes("<br>"));
      rec("hardBreakStrict", R("a  \\nb", "", true).includes("<br>"));
      rec("paraNoBr", !R("p1\\n\\np2", "", false).includes("<br>"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r87-probe.js"), probe);
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

console.log("— markdown-it breaks flip on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("default (strict OFF) → single newline <br>", data.defaultBr === true);
ok("strict ON → no <br> (CommonMark join)", data.strictNoBr === false);
ok("two trailing spaces → <br> even in strict", data.hardBreakStrict === true);
ok("blank-line paragraphs → no <br>", data.paraNoBr === true);

console.log(`\nR87 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
