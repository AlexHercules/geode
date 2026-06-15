/**
 * R89 desktop probe — verifies resolveNewNoteFolder + createNewNote on the REAL
 * Tauri / WKWebView build + real fs: each location setting resolves the right
 * folder, and createNewNote lands the note there (folder auto-created). The
 * settings DOM is browser-E2E only (r89-e2e, §D). Run: node .calibration/r89-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve as presolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = presolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r89-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r89-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(join(VAULT, "area"), { recursive: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "area", "current.md"), "# current\n");

const probe = `module.exports = {
  id: "r89-probe", name: "r89-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r89-results.md", b).catch(() => app.vault.modify("r89-results.md", b).catch(() => {})); };
    try {
      const RF = (globalThis).__geodeNewNoteFolder, CN = (globalThis).__geodeCreateNewNote;
      rec("present", typeof RF === "function" && typeof CN === "function");
      rec("root", RF("root", "", "area/current.md"));
      rec("current", RF("current", "", "area/current.md"));
      rec("folderResolve", RF("folder", "Inbox/Deep", "x.md"));
      // create one in the specified folder (auto-creates Inbox/Deep) — real fs
      const p = await CN("Captured");
      rec("createdPath", p);
      rec("createdExists", app.vault.fileExists(p));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r89-probe.js"), probe);
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

console.log("— resolveNewNoteFolder + createNewNote on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hooks present", data.present === true);
ok("root → \"\"", data.root === "", JSON.stringify(data.root));
ok("current + active in area/ → area", data.current === "area", JSON.stringify(data.current));
ok("folder resolves the specified path", data.folderResolve === "Inbox/Deep", JSON.stringify(data.folderResolve));
ok("createNewNote landed in the specified folder", data.createdPath === "Inbox/Deep/Captured.md", JSON.stringify(data.createdPath));
ok("the created note exists on disk", data.createdExists === true);
// the nested folder was actually created on real fs
ok("nested target folder created on disk", existsSync(join(VAULT, "Inbox", "Deep", "Captured.md")));

console.log(`\nR89 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
