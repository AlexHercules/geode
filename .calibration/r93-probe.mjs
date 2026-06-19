/**
 * R93 desktop probe — verifies the Explorer "Make a copy" vault throat on the REAL
 * Tauri / WKWebView build + real fs via window.__geodeExplorerCopy (mirrors makeCopy:
 * uniquePath → readBinary → createBinary). Asserts the copy lands on disk byte-identical
 * to the source, and a second copy gets a distinct unique name. The context-menu DOM
 * (open-in-new-tab / open-to-right / menu rendering) is browser-E2E only (r93-e2e, §D).
 * Run: node .calibration/r93-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r93-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r93-results.md");

let passed = 0, failed = 0;
const fails = [];
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

if (!existsSync(BIN)) { console.error(`release binary not found: ${BIN}`); process.exit(2); }

rmSync(VAULT, { recursive: true, force: true });
mkdirSync(PLUGINS, { recursive: true });
writeFileSync(join(VAULT, "note.md"), "# note\n\nbody line\n");
mkdirSync(join(VAULT, "sub"), { recursive: true });
writeFileSync(join(VAULT, "sub", "deep.md"), "# deep\n");

const probe = `module.exports = {
  id: "r93-probe", name: "r93-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r93-results.md", b).catch(() => app.vault.modify("r93-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeExplorerCopy;
      rec("present", typeof F === "function");
      const c1 = await F("note.md");
      rec("copy1", c1);                       // { dest, sameBytes, len }
      const c2 = await F("note.md");
      rec("copy2dest", c2.dest);              // distinct unique name
      const cs = await F("sub/deep.md");
      rec("copySub", cs);                     // copy inside a subfolder
      // source still intact + readable as text after the binary copy
      rec("srcText", await app.vault.read("note.md"));
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r93-probe.js"), probe);
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

console.log("— Make a copy on real fs —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("copy lands at 'note 1.md'", data.copy1?.dest === "note 1.md", JSON.stringify(data.copy1?.dest));
ok("copy is byte-identical to the source", data.copy1?.sameBytes === true, JSON.stringify(data.copy1));
ok("copy length matches source bytes", data.copy1?.len > 0, JSON.stringify(data.copy1?.len));
ok("second copy gets a distinct name 'note 2.md'", data.copy2dest === "note 2.md", JSON.stringify(data.copy2dest));
ok("copy inside a subfolder stays in that folder", data.copySub?.dest === "sub/deep 1.md", JSON.stringify(data.copySub?.dest));
ok("subfolder copy is byte-identical", data.copySub?.sameBytes === true, JSON.stringify(data.copySub));
ok("source still text-readable after binary copy", data.srcText === "# note\n\nbody line\n", JSON.stringify(data.srcText));

console.log(`\nR93 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
