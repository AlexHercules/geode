/**
 * R90 desktop probe — verifies nodeGroupColor + parseGraphPrefs groups on the REAL
 * Tauri / WKWebView build via window.__geodeGraphGroupColor / __geodeGraphPrefs
 * (synchronous, App-Nap-safe). The settings list DOM + canvas are browser-E2E only
 * (r90-e2e, §D). Run: node .calibration/r90-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r90-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r90-results.md");

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
  id: "r90-probe", name: "r90-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r90-results.md", b).catch(() => app.vault.modify("r90-results.md", b).catch(() => {})); };
    try {
      const C = (globalThis).__geodeGraphGroupColor, P = (globalThis).__geodeGraphPrefs;
      rec("present", typeof C === "function" && typeof P === "function");
      const node = { id: "Projects/Roadmap.md", label: "Roadmap" };
      rec("none", C(node, [], "#acc"));
      rec("text", C(node, [{ query: "road", color: "#ff0000" }], "#acc"));
      rec("path", C(node, [{ query: "path:Projects", color: "#00ff00" }], "#acc"));
      rec("firstWins", C(node, [{ query: "road", color: "#111111" }, { query: "path:Projects", color: "#222222" }], "#acc"));
      rec("compatEmpty", P('{"mode":"local"}').groups);
      rec("compatBadDropped", P('{"groups":[{"query":"x","color":"red"},{"query":"y","color":"#123456"}]}').groups.length);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r90-probe.js"), probe);
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

console.log("— nodeGroupColor + parseGraphPrefs groups on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hooks present", data.present === true);
ok("no groups → default", data.none === "#acc", JSON.stringify(data.none));
ok("text matches label", data.text === "#ff0000", JSON.stringify(data.text));
ok("path: matches folder", data.path === "#00ff00", JSON.stringify(data.path));
ok("first matching group wins", data.firstWins === "#111111", JSON.stringify(data.firstWins));
ok("old blob → groups []", Array.isArray(data.compatEmpty) && data.compatEmpty.length === 0);
ok("invalid color dropped", data.compatBadDropped === 1, JSON.stringify(data.compatBadDropped));

console.log(`\nR90 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
