/**
 * R107 desktop probe — verifies wikilinkHeadingTargets (the `[[<note>#` heading-completion
 * resolver) on the real Tauri / WKWebView build + real fs via window.__geodeHeadingComplete:
 * resolves the note, lists its headings, skips unsafe-char headings, `[[#` self-targets the
 * given path. The CM autocomplete DOM is browser-E2E only (§D). Run:
 * node .calibration/r107-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r107-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r107-results.md");

let passed = 0, failed = 0;
const fails = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "Head.md"), "# Intro\n\n## Setup\n\n### Details\n\n## Bad]Head\n");
writeFileSync(join(VAULT, "Src.md"), "# Src\n");

const probe = `module.exports = {
  id: "r107-probe", name: "r107-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r107-results.md", b).catch(() => app.vault.modify("r107-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeHeadingComplete;
      rec("present", typeof F === "function");
      await new Promise((r) => setTimeout(r, 400)); // let the index parse headings
      rec("noteHash", F("Head#", "Src.md"));
      rec("selfHash", F("#", "Head.md"));
      rec("noHash", F("Head", "Src.md"));
      rec("unresolved", F("Nope#", "Src.md"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r107-probe.js"), probe);
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

console.log("— wikilinkHeadingTargets on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("`[[Head#` → [Intro, Setup, Details] (Bad]Head filtered)", eq(data.noteHash, ["Intro", "Setup", "Details"]), JSON.stringify(data.noteHash));
ok("`[[#` from Head.md → its own headings (self-link)", eq(data.selfHash, ["Intro", "Setup", "Details"]), JSON.stringify(data.selfHash));
ok("`[[Head` (no #) → null", data.noHash === null, JSON.stringify(data.noHash));
ok("`[[Nope#` (unresolvable) → null", data.unresolved === null, JSON.stringify(data.unresolved));

console.log(`\nR107 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
