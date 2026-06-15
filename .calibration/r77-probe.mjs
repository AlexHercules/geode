/**
 * R77 desktop probe — verifies blockRefAt on the REAL Tauri / WKWebView build +
 * real filesystem via window.__geodeBlockRef (reads the note from disk, runs the
 * pure mint logic — App-Nap-safe). The command (clipboard + CM dispatch) is
 * browser-E2E only (r77-e2e); WKWebView DOM reads are unreliable under App-Nap
 * (data-safety §D). Proves the real-fs mint path. Run: node .calibration/r77-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r77-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r77-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "para.md"), "first paragraph here\n\nsecond block\n");
writeFileSync(join(VAULT, "hasid.md"), "already tagged ^abc123\n");
writeFileSync(join(VAULT, "fence.md"), "```js\nconst a = 1;\n```\n");
writeFileSync(join(VAULT, "fm.md"), "---\ntitle: T\n---\n\nbody para\n");

const probe = `module.exports = {
  id: "r77-probe", name: "r77-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r77-results.md", b).catch(() => app.vault.modify("r77-results.md", b).catch(() => {})); };
    try {
      const B = (globalThis).__geodeBlockRef;
      rec("present", typeof B === "function");
      rec("para", await B("para.md", 3));
      rec("hasid", await B("hasid.md", 3));
      rec("fence", await B("fence.md", 12));
      rec("fm", await B("fm.md", 4));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r77-probe.js"), probe);
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

console.log("— blockRefAt on real WKWebView + real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("__geodeBlockRef present", data.present === true);
ok("paragraph → mints 6-char id + edit", data.para && data.para.edit && /^[a-z0-9]{6}$/.test(data.para.id) && data.para.edit.insert === " ^" + data.para.id, JSON.stringify(data.para));
ok("existing id → reuse, edit null", data.hasid && data.hasid.id === "abc123" && data.hasid.edit === null, JSON.stringify(data.hasid));
ok("inside code fence → null", data.fence === null, JSON.stringify(data.fence));
ok("inside frontmatter → null", data.fm === null, JSON.stringify(data.fm));

console.log(`\nR77 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
