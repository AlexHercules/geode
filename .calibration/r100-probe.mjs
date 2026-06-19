/**
 * R100 desktop probe — verifies the tab-title-bar + status-bar toggles persist on the
 * REAL Tauri / WKWebView build via window.__geodeAppearance.setChrome (Store + localStorage,
 * returns the live values). The DOM (tab-bar / status-bar visibility) is browser-E2E only
 * (r100-e2e, §D — pure display). Run: node .calibration/r100-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r100-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r100-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "note.md"), "# n\n");

const probe = `module.exports = {
  id: "r100-probe", name: "r100-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r100-results.md", b).catch(() => app.vault.modify("r100-results.md", b).catch(() => {})); };
    try {
      const A = (globalThis).__geodeAppearance;
      rec("present", !!A && typeof A.setChrome === "function");
      rec("bothOff", A.setChrome(false, false));
      rec("bothOn", A.setChrome(true, true));
      rec("mixed", A.setChrome(false, true));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r100-probe.js"), probe);
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

console.log("— tab-title-bar + status-bar toggles on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("both off → both false", data.bothOff?.tabTitleBar === false && data.bothOff?.statusBar === false, JSON.stringify(data.bothOff));
ok("both on → both true", data.bothOn?.tabTitleBar === true && data.bothOn?.statusBar === true, JSON.stringify(data.bothOn));
ok("mixed (tab off, status on) round-trips", data.mixed?.tabTitleBar === false && data.mixed?.statusBar === true, JSON.stringify(data.mixed));

console.log(`\nR100 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
