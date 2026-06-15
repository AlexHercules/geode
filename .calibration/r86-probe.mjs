/**
 * R86 desktop probe — verifies the FilePropertiesPanel's SECOND-WRITER delete path
 * on the REAL Tauri / WKWebView build + real fs: acquire the shared handle, apply
 * buildRemoveProperty via applyExternalEdits, and confirm the property is gone from
 * the document text while the rest of the frontmatter survives (data-safety). The
 * panel DOM is browser-E2E only (r86-e2e, §D). Run: node .calibration/r86-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r86-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r86-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
// a note with three frontmatter properties; we delete the middle one
writeFileSync(join(VAULT, "note.md"), "---\nauthor: Ada\nstatus: draft\ncount: 7\n---\n# note\n");

const probe = `module.exports = {
  id: "r86-probe", name: "r86-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r86-results.md", b).catch(() => app.vault.modify("r86-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeFilePropsRemove;
      rec("present", typeof F === "function");
      const r = await F("note.md", "status");
      rec("hadStatus", /status:\\s*draft/.test(r.before));
      rec("removedStatus", !/status:/.test(r.after));
      rec("keptAuthor", /author:\\s*Ada/.test(r.after));
      rec("keptCount", /count:\\s*7/.test(r.after));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r86-probe.js"), probe);
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

console.log("— FilePropertiesPanel second-writer delete on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("note had the status property", data.hadStatus === true);
ok("applyExternalEdits removed the status property", data.removedStatus === true);
ok("author property survived the delete", data.keptAuthor === true);
ok("count property survived the delete", data.keptCount === true);

console.log(`\nR86 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
