/**
 * R73 desktop probe — verifies cssclasses TOKEN extraction on the REAL Tauri /
 * WKWebView build + real filesystem via window.__geodeCssClasses (reads the note
 * from disk, runs getCssClasses — synchronous logic, App-Nap-safe). The DOM
 * application onto `.preview-content` / `.editor-cm-host` is browser-E2E only
 * (r73-e2e); WKWebView DOM reads are unreliable under App-Nap (data-safety §D).
 * This proves the real-fs frontmatter → tokens path on real disk.
 *
 * Run: node .calibration/r73-probe.mjs   (release binary must be built)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r73-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r73-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
const fm = (body) => `---\n${body}\n---\n# Note\n\nbody\n`;
writeFileSync(join(VAULT, "list.md"), fm("cssclasses:\n  - alpha\n  - beta"));
writeFileSync(join(VAULT, "space.md"), fm("cssclasses: gamma delta"));
writeFileSync(join(VAULT, "comma.md"), fm("cssclasses: epsilon, zeta"));
writeFileSync(join(VAULT, "legacy.md"), fm("cssclass: legacyone"));
writeFileSync(join(VAULT, "dup.md"), fm("cssclasses: [dd, dd, ee]"));
writeFileSync(join(VAULT, "plain.md"), "# Plain\n\nno frontmatter\n");

const probe = `module.exports = {
  id: "r73-probe", name: "r73-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r73-results.md", b).catch(() => app.vault.modify("r73-results.md", b).catch(() => {})); };
    try {
      const C = (globalThis).__geodeCssClasses;
      rec("present", typeof C === "function");
      rec("list", await C("list.md"));
      rec("space", await C("space.md"));
      rec("comma", await C("comma.md"));
      rec("legacy", await C("legacy.md"));
      rec("dup", await C("dup.md"));
      rec("plain", await C("plain.md"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r73-probe.js"), probe);
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
const arr = (v) => (Array.isArray(v) ? v : []);
const eq = (v, exp) => JSON.stringify(arr(v)) === JSON.stringify(exp);

console.log("— cssclasses token extraction on real WKWebView + real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeCssClasses present", data.present === true);
ok("YAML list → [alpha, beta]", eq(data.list, ["alpha", "beta"]), JSON.stringify(data.list));
ok("space-string → [gamma, delta] (split)", eq(data.space, ["gamma", "delta"]), JSON.stringify(data.space));
ok("comma-string → [epsilon, zeta]", eq(data.comma, ["epsilon", "zeta"]), JSON.stringify(data.comma));
ok("legacy cssclass → [legacyone]", eq(data.legacy, ["legacyone"]), JSON.stringify(data.legacy));
ok("dedupe [dd, dd, ee] → [dd, ee]", eq(data.dup, ["dd", "ee"]), JSON.stringify(data.dup));
ok("no frontmatter → []", eq(data.plain, []), JSON.stringify(data.plain));

console.log(`\nR73 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
