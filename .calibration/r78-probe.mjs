/**
 * R78 desktop probe — verifies parseGraphPrefs (clamp / backward-compat /
 * corrupt) on the REAL Tauri / WKWebView build via window.__geodeGraphPrefs
 * (synchronous, App-Nap-safe). The settings-panel DOM + canvas are browser-E2E
 * only (r78-e2e); WKWebView DOM reads are unreliable under App-Nap (§D). This
 * proves the prefs validation runs correctly in the real build.
 * Run: node .calibration/r78-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r78-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r78-results.md");

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
  id: "r78-probe", name: "r78-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r78-results.md", b).catch(() => app.vault.modify("r78-results.md", b).catch(() => {})); };
    try {
      const G = (globalThis).__geodeGraphPrefs;
      rec("present", typeof G === "function");
      rec("clamp", G('{"forces":{"repel":99999,"center":-5}}'));
      rec("old", G('{"mode":"local","depth":2,"showAll":true}'));
      rec("corrupt", G("}{not json"));
      rec("live", G());
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r78-probe.js"), probe);
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

console.log("— parseGraphPrefs on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeGraphPrefs present", data.present === true);
ok("clamp: repel→600, center→0", data.clamp?.forces?.repel === 600 && data.clamp?.forces?.center === 0, JSON.stringify(data.clamp?.forces));
ok("old blob → forces/display default in (backward compat)", data.old?.forces?.repel === 200 && data.old?.display?.nodeSize === 1 && data.old?.mode === "local", JSON.stringify(data.old));
ok("corrupt → all defaults", data.corrupt?.forces?.linkDistance === 70 && data.corrupt?.display?.arrows === false, JSON.stringify(data.corrupt));
ok("live (fresh vault) → defaults", data.live?.forces?.repel === 200 && data.live?.display?.labelThreshold === 0.8, JSON.stringify(data.live));

console.log(`\nR78 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
