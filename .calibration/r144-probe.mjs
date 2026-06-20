/**
 * R144 desktop probe — verifies the new compat Menu methods (static forEvent + setParentElement)
 * on the REAL Tauri/WKWebView build via the always-on __geodeMenuProbe hook (synchronous menu
 * construct → show → click → hide; App-Nap-safe, no async render).
 *
 * Run: node .calibration/r144-probe.mjs   (release binary must be built WITH R144)
 * Contract: docs/ARCHITECTURE.md "Round 144 additions".
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r144-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r144-results.md");

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
  id: "r144-probe", name: "r144-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r144-results.md", b).catch(() => app.vault.modify("r144-results.md", b).catch(() => {})); };
    try {
      const P = (globalThis).__geodeMenuProbe;
      rec("present", typeof P === "function");
      const r = P();
      rec("isMenu", r.isMenu);
      rec("chainable", r.chainable);
      rec("shown", r.shown);
      rec("fired", r.fired);
      rec("strayAfter", document.querySelectorAll(".geode-compat-menu").length);
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r144-probe.js"), probe);
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

console.log("— compat Menu forEvent + setParentElement on real WKWebView —");
ok("error-free probe run", data.error === undefined, J(data.error));
ok("__geodeMenuProbe present", data.present === true);
ok("Menu.forEvent(evt) returns a Menu instance", data.isMenu === true, J(data.isMenu));
ok("setParentElement(el) is chainable", data.chainable === true, J(data.chainable));
ok("menu shows in DOM with its item", data.shown === true, J(data.shown));
ok("clicking the item fires onClick", data.fired === true, J(data.fired));
ok("no menu left attached after hide", data.strayAfter === 0, J(data.strayAfter));

console.log(`\nR144 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
