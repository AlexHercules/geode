/**
 * R98 desktop probe — verifies the "Show more context" paragraph boundary logic on the
 * REAL Tauri / WKWebView build via window.__geodeBacklinkParagraph(content, from): the
 * blank-line-delimited block around an offset. The panel DOM + the toggle + the async
 * source re-read are browser-E2E only (r98-e2e, §D). Run: node .calibration/r98-probe.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BIN = join(repo, "src-tauri/target/release/geode");
const VAULT = join(here, "r98-probe-vault");
const PLUGINS = join(VAULT, ".geode/plugins");
const RESULTS = join(VAULT, "r98-results.md");

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
  id: "r98-probe", name: "r98-probe",
  async onload(app) {
    const out = [];
    const rec = (k, v) => { out.push(k + "=" + JSON.stringify(v)); const b = out.join("\\n");
      app.vault.create("r98-results.md", b).catch(() => app.vault.modify("r98-results.md", b).catch(() => {})); };
    try {
      const F = (globalThis).__geodeBacklinkParagraph;
      rec("present", typeof F === "function");
      const C = "a\\nb match\\nc\\n\\nd\\n"; // "match" at 4, blank line before "d"
      rec("block", F(C, 4));      // -> "a\\nb match\\nc"
      rec("isolated", F(C, 13));  // -> "d"
      rec("solo", F("solo line", 0));
      rec("firstLine", F(C, 0));  // offset in first line -> whole paragraph
      rec("done", true);
    } catch (e) { rec("error", String(e)); rec("done", true); }
  }
};
`;
writeFileSync(join(PLUGINS, "r98-probe.js"), probe);
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

console.log("— paragraph boundary on real WKWebView —");
ok("error-free probe run", data.error === undefined, JSON.stringify(data.error));
ok("hook present", data.present === true);
ok("block around offset = the non-blank-line run", data.block === "a\nb match\nc", JSON.stringify(data.block));
ok("separate paragraph after a blank line is isolated", data.isolated === "d", JSON.stringify(data.isolated));
ok("single-line note → just that line", data.solo === "solo line", JSON.stringify(data.solo));
ok("offset in the first line → whole paragraph", data.firstLine === "a\nb match\nc", JSON.stringify(data.firstLine));

console.log(`\nR98 desktop probe: ${passed} passed, ${failed} failed`);
if (failed) console.log("FAILED:", fails.join(", "));
process.exit(failed ? 1 : 0);
